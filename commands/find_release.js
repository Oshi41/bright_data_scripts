#!/usr/bin/env node
const yargs_root = require('yargs');
const path = require('path');
const os = require('os');
const fs = require('fs');
const _ = require('lodash');
const {zrequire, get_zon_root} = require('../utils.js');
const etask = zrequire('../../util/etask.js');
const date = zrequire('../../util/date.js');
const wget = zrequire('../../util/wget.js');
const exec = zrequire('../../util/exec.js');
const mongodb = zrequire('../../util/mongodb.js');
const {nl2jn, qw} = zrequire('../../util/string.js');
const system_db = zrequire('../../system/db/db.js');
const mdoc_config = system_db.use('mdoc_config');
const own_username = process.env.USER;

const get_date = (_date, add = undefined)=>{
    _date = date(_date);
    if (add)
    {
        _date = date.add(_date, add);
    }
    return date.strftime('%d-%b-%Y', _date);
};
const find_proc = (opt)=>{
    opt.server = opt.server?.toLowerCase()?.replace(/-/g, '_');
    let rel_procs = Object.values(mdoc_config.deploy_procedures)
        .filter(f=>!f.no_release);
    let proc = rel_procs.find(x=>x.id == opt.server);
    if (!proc && opt.throw)
    {
        throw new Error(`Wrong --server=${opt.server}, see examples:\n\n`
            +rel_procs.map(x=>x.id.replace(/_/g, '-')).sort().join('\n'));
    }
    return proc;
};

const find_release_cmd = {
    command: '$0',
    describe: `Print releases which related to users change`,
    builder: yargs=>yargs
        .option('user', {
            alias: 'u',
            type: 'string',
            default: own_username,
            describe: 'Which user releases we want to search',
        })
        .option('server', {
            alias: 's',
            type: 'string',
            default: '',
            describe: 'Which server we need to check',
        })
        .coerce('server', etask.fn(function*(txt){
            yield system_db.subscribe(['lum', 'lum-views']);
            let proc = find_proc({server: txt});
            return proc;
        }))
        .option('from', {
            alias: 'f',
            type: 'string',
            default: get_date(date(), {day: -1}),
            describe: 'Searching from this date',
        })
        .coerce('from', txt=>{
            let res = date(txt);
            if (res instanceof Date)
                return res;
            throw new Error('--from should be date like');
        })
        .option('to', {
            alias: 't',
            type: 'string',
            default: get_date(date()),
            describe: 'Searching to this date',
        })
        .coerce('to', txt=>{
            let res = date(txt);
            if (res instanceof Date)
                return res;
            throw new Error('--to should be date like');
        })
    ,
    handler: etask.fn(function*(opt){
        this.on('uncaught', e=>console.error('CRIT:', e));
        this.finally(process.exit);
        let history_q = {path: 'zon/pkg/system/db/servers_version.json',
            description: {$regex: new RegExp('^release '+(opt.server?.server||''))},
            date: {$gte: opt.from, $lte: opt.to},
        };
        let checkins_q = {login: opt.user,
            date: {$gte: opt.from, $lte: opt.to},
        };
        let history_map = new Map();
        let [history, checkins] = yield etask.all([history_q, checkins_q]
            .map(x=>mongodb.find_all('checkins', x)));
        console.log(`Founded ${checkins.length} checkins from ${opt.user}`);
        for (let elem of history)
        {
            let [, server, version] = elem.description.split(' ').map(x=>x.trim())
                .filter(Boolean);
            if (!history_map.has(server))
                history_map.set(server, []);
            history_map.get(server).push({
                ..._.pick(elem, qw`date login description`),
                server, version,
            });
        }
        console.log(`Founded ${history.length} releases`);
        let pkg_root = path.join(get_zon_root(process.cwd()), 'pkg');
        let f2h_file = path.join(pkg_root, 'file2host.json');
        if (!fs.existsSync(f2h_file))
        {
            console.log('Building dependencies tree');
            let res = yield exec.sys(['node', 'system/scripts/file2host.js', '--cache'],
            {
                cwd: pkg_root,
                env: process.env,
                stdall: 'pipe',
                encoding: 'utf8',
                log: () => {
                },
            });
            if (res.retval)
                return console.error(res.stderr.toString());
        }
        if (!fs.existsSync(f2h_file))
            return console.error('No dependencies file founded');
        let deps = JSON.parse(fs.readFileSync(f2h_file, 'utf-8'));
        deps = new Map(Array.from(Object.entries(deps)).map(([key, val])=>{
            key = path.resolve(pkg_root, key);
            key = path.relative(pkg_root, key);
            return [key, val];
        }));
        const z_src = path.join('zon', 'pkg');
        let pending = [], user_releases = [];
        for (let checkin of checkins)
        {
            let {date: d, path: p} = checkin;
            p = path.relative(z_src, p);
            let rel_servers = deps.get(p);
            if (!rel_servers?.length)
                continue;
            for (let srv of rel_servers)
            {
                if (opt.server && opt.server.server != srv)
                    continue;

                let releases = _.sortBy(history_map.get(srv)||[], x=>x.date);
                if (!releases?.length)
                {
                    pending.push(srv);
                    continue;
                }
                let first_version = releases.find(x=>x.date > d)?.version;
                if (!first_version)
                {
                    pending.push(srv);
                    continue;
                }
                releases = releases.filter(x=>x.version == first_version);
                user_releases.push(_.last(releases));
            }
        }
        if (pending.length)
        {
            let log_rec = 'Found no releases for listed servers:\n'
                +pending.join('\n');
            if (opt.server)
                log_rec += '\n\nTry to remove --server option'
            console.log(log_rec);
        }
        user_releases = _.sortBy(_.uniq(user_releases, false, x=>x.server+x.date), x=>x.date);
        console.log(`Founded ${user_releases.length} releases`);
        for (let {server, version, date: d} of user_releases)
        {
            console.log(`[${date.strftime('%Y-%m-%d %H:%M:%S', d)}] ${server} ${version}`);
        }
        console.log('DONE');
    }),
}

yargs_root
    .command(find_release_cmd)
    .completion('bash_completion', false)
    .help()
    .demandCommand()
    .recommendCommands()
    .wrap(yargs_root.terminalWidth())
    .argv;