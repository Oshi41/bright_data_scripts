#!/usr/bin/env node
const yargs_root = require("yargs");
const path = require("path");
const os = require('os');
const fs = require('fs');
const diff = require('diff');
const _ = require('lodash');
const {zrequire, zon_n_require} = require("../utils.js");
const mongodb = zrequire('../../util/mongodb.js');
const etask = zrequire('../../util/etask.js');
const {nl2jn} = zrequire('../../util/string.js');
const date = zrequire('../../util/date.js');
const system_db = zrequire('../../system/db/db.js');
const local_require = zon_n_require(); // any working zon dir

local_require('util/config.js');
const zendesk = local_require('svc/zendesk/lib.js');
const monday = local_require('svc/monday/lib.js');
const {Open_ai_client} = local_require('svc/openai/openai.js');

const server_conf = system_db.use('server_conf', 'lum');
const cfg_dir = path.join(os.homedir(), 'tickets_progress');
if (!fs.existsSync(cfg_dir))
    fs.mkdirSync(cfg_dir);

const df = d=>date.strftime('%Y-%m-%d %H:%M:%S', d);
function get_zendesk_comments(comments){
    return comments.map(x=>nl2jn`[${df(x.created_at)}] ${x.author.name}\n
        ${x.plain_body}`).join('\n');
}

/**
 * @param arrs {Array<{
 * ticket_id: number,
 * id: number,
 * discussion_short: string,
 * issue: string,
 * fix: string,
 * status: string,
 * title: string,
 * closed_by_user: string,
 * is_ticket: string,
 * }>}
 */
function print(arrs){
    const groups = [
        ['Handled', x=>x.closed_by_user],
        ['Participated', x=>x.status == 'DONE'],
        ['Cancelled', x=>x.status == 'Cancelled'],
        ['In progress'],
    ];
    const to_str = t=>{
        let txts = [`[${t.is_ticket ? '*' : ''}${t.status}] ${t.title} ${t.url}`];
        if (t.discussion_short)
            txts.push(' '.repeat(4) +'Short summary: '+t.discussion_short);
        if (t.issue)
            txts.push(' '.repeat(4)+'Ticket issue: '+t.issue);
        if (t.fix)
            txts.push(' '.repeat(4)+'Ticket fix: '+t.fix);
        if (txts.length)
            txts.unshift('-'.repeat(100));
        return txts.join('\n');
    }
    for (let [name, fn] of groups)
    {
        let grouped = arrs.filter(fn || (()=>true));
        if (!grouped.length)
            continue;
        arrs = arrs.filter(x=>!grouped.includes(x));
        grouped = _.sortBy(grouped, [x=>-x.is_ticket, 'status',
            'title']);
        console.log(`\n[${grouped.length}]`, name);
        console.log(grouped.map(to_str).join('\n'));
    }
}

function get_week_dir_name(now){
    let dir = path.join(cfg_dir, process.env.USER);

    while (date.strftime('%w', now) !== '0')
        now = date.add(now, {d: -1});

    return path.join(dir, df(date.align(now, 'DAY')).replace(/ /g, '_'));
}

const main = {
    command: '$0',
    describe: 'Prints tickets handling history and provides short summary' +
        ' for them',
    handler: etask.fn(function*(opt){
        this.finally(process.exit);
        this.on('uncaught', e=>console.error('CRIT:', e));
        yield system_db.update(['lum', 'lum-views']);
        yield monday.init({only_update: true});

        let user = process.env.USER+'@brightdata.com';
        let m_user = yield monday.user.get_by_email(user);
        if (!m_user)
            throw new Error('Cannot find monday user: '+user);
        let $lte = date();
        let $gte = date.add(date.align($lte, 'DAY'), {d: -7});

        let week_dir = get_week_dir_name($gte);
        if (!fs.existsSync(week_dir))
            fs.mkdirSync(week_dir);

        let history = yield mongodb.find_all('monday_activities', {
            user_id: m_user.id, created_at: {$gte, $lte},
        }, {sort: {created_at: -1}});
        let task_ids = _.uniq(history.map(x=>x.pulse_id).filter(Boolean));
        let saved = task_ids.map(x=>path.join(week_dir, x+'.json'));
        if (saved.every(x=>fs.existsSync(x)))
        {
            console.log('Load cached result');
            saved = saved.map(x=>JSON.parse(fs.readFileSync(x, 'utf-8')));
            print(saved);
            return;
        }

        let m_tasks = yield monday.task.get_by_ids(task_ids);
        let task_map = new Map(m_tasks.map(x=>{
            let id = x.id, title = x.name, ticket_id;
            let status = _.get(x, 'group.title');
            let by_user = _.get(history.filter(h=>h.pulse_id == x.id)
                    .find(h=>h.column_title == 'Status'),
                'value.label.text') == 'Done' && status == 'DONE';
            let link_col = _.get(x.column_values.find(cv=>cv.id == 'link'),
                'value');
            let url = _.get(JSON.parse(link_col||'{}'), 'url',
                nl2jn`https://brightdata-group.monday.com/boards/
                        ${x.board.id}/pulses/${id}`);
            ticket_id = +_.get(JSON.parse(link_col || '{}'), 'text', undefined);
            let meta = {
                id,
                title,
                status,
                url,
                ticket_id, //zendesk ticket ID
                closed_by_user: by_user, // user closed ticket by himself
                is_ticket: Number.isInteger(ticket_id),
            };
            return [x, meta];
        }));
        let authors_map = new Map();
        console.log(nl2jn`[${user}] Week 
                progress: ${df($gte)} -> ${df($lte)}, found ${m_tasks.length} 
                uniq tickets`);
        let openai_api = new Open_ai_client({
            model: 'gpt-3.5-turbo',
            ...server_conf.azure_ai
        });
        for (let [task, meta] of task_map)
        {
            if (meta.ticket_id)
            {
                let comments = yield zendesk.api.tickets.get_comments(meta.ticket_id, true);
                let to_load = _.uniq(comments.map(x=>x.author_id)).filter(x=>!authors_map.has(x));
                if (to_load.length)
                {
                    let {users} = yield zendesk.api.users.list_many(to_load);
                    users.forEach(x=>authors_map.set(x.id, x));
                }
                comments.forEach(x=>x.author = authors_map.get(x.author_id));
                meta.discussion = get_zendesk_comments(comments);
                try {
                    let resp = yield openai_api.complete([
                        'You will receive raw ticket discussion. You need to '
                        +'create short summary of the ticket and do not '
                        +'loose any valuable data.',
                        meta.discussion
                    ]);
                    meta.discussion_short = resp[0].text;
                    resp = yield openai_api.complete([
                        'You will receive raw ticket discussion. Explain' +
                        ' what was the issue explained in this ticket',
                        meta.discussion
                    ]);
                    meta.issue = resp[0].text;
                    resp = yield openai_api.complete([
                        'You will receive raw ticket discussion. Explain' +
                        ' how this ticket was fixed',
                        meta.discussion
                    ]);
                    meta.fix = resp[0].text;
                } catch(e) {
                    console.log('Failed Openai request:', e);
                }
            }
            fs.writeFileSync(path.join(week_dir, task.id+'.json'),
                JSON.stringify(meta, null, 2));
        }
        print(Array.from(task_map.values()));
    }),
};

yargs_root
    .command(main)
    .completion('bash_completion', false)
    .help()
    .demandCommand()
    .recommendCommands()
    .wrap(yargs_root.terminalWidth())
    .argv;