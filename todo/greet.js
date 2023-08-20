const yargs_root = require('yargs');
const _ = require('lodash');
const {zrequire, parse_cvs_status, exec_and_record: r_exec, tables} = require("utils.js");
const etask = zrequire('../../util/etask.js');
const exec = zrequire('../../util/exec.js');
const date = zrequire('../../util/date.js');
const cli = zrequire('../../util/cli.js');
const mongo_util = zrequire('../../util/mongo_util.js');
const E = exports;

const exec_and_record = (args, opt, file, descr) => {
    if (opt.hdr) {
        let hdr = `[${opt.hdr}]`;
        opt.log = d => console.log(hdr, d.toString());
        delete opt.hdr;
    }
    return r_exec(() => etask(function* () {
        let sys_opts = {
            env: process.env,
            stdall: 'pipe',
            encoding: 'utf8',
            ..._.omit(opt, ['log']),
        };
        if (opt.transparent_log)
            sys_opts.log = d => console.log(d?.toString()?.trim());
        let res = yield exec.sys(args, sys_opts);
        if (res.retval) {
            throw new Error(res.stderr.toString());
        }
        return res;
    }), file, descr, opt);
};

const last_reboot_time_lin = () => etask(function* () {
    let d, res = yield exec.sys(['who', '-b'], {
        env: process.env,
        stdall: 'pipe',
        encoding: 'utf8',
    });
    for (let s of res.stdall.split('\n').map(x => x.trim()).filter(Boolean)) {
        s = s.split(' ').filter(Boolean);
        let raw_date = s[2] + ' ' + s[3];
        raw_date = Date.parse(raw_date);
        if (!Number.isFinite(raw_date))
            continue;

        raw_date = new Date(raw_date);
        if (!d || raw_date > d)
            d = raw_date;
    }
    return d;
});

const run = {
    command: '$0',
    args: '<pass>',
    describe: 'Pre work procedures',
    builder: yargs => yargs
        .positional('pass', {describe: 'Mongo password'})
        .option('force', {describe: 'Force zupdate'}),
    handler: opt => etask(function* () {
        this.on('uncaught', console.error.bind(console));
        this.finally(() => console.log('DONE'));
        let pass = opt._[0];
        if (!pass)
            return console.log('No password provided');
        const {exec_time} = yield tables();
        const search = {date: {$gte: yield last_reboot_time_lin()}, success: true};
        let prev_run = yield exec_time.find({file: 'zupdate', ...search});
        if (!prev_run?.length)
        {

        }
        if (!prev_run?.length || opt.force) {
            yield exec_and_record(['zupdate'],
                {hdr: 'zupdate', transparent_log: true}, 'zupdate');
        }

        prev_run = yield exec_time.find({file: 'mongo_login', ...search});
        if (!prev_run?.length || opt.force) {
            let cred, orig = cli.get_input;
            try {
                cli.get_input = () => pass;
                cred = yield mongo_util.get_cred({auth_nokeyring: true});
                yield exec_and_record(['mongo_login', '--no-reauth'],
                    {hdr: 'Check mongo connect'}, 'mongo_login', 'no-reauth');
                console.log('Authorized');
            } finally {
                cli.get_input = orig;
            }
        }
    }),
}

yargs_root.scriptName('greet')
    .command(run)
    .completion('bash_completion', false)
    .help()
    .demandCommand()
    .recommendCommands()
    .wrap(yargs_root.terminalWidth())
    .argv;

E.last_reboot_time_lin = last_reboot_time_lin;
