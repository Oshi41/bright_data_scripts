#!/usr/bin/env node
const _ = require('lodash');
const path = require('path');
const yargs_root = require('yargs');
const fs = require('fs');
const {
    zrequire, exec_and_record: r_exec, get_zon_root,
    find_test_files, get_zon_relative, scan_for_test_descriptions,
    tables: _tables, fmt_num, pipe_lines, approval
} = require('../utils.js');
const etask = zrequire('../../util/etask.js');
const {nl2jn} = zrequire('../../util/string.js');
const sprintf = zrequire('../../util/sprintf.js');
const exec = zrequire('../../util/exec.js');
const cli = zrequire('../../util/cli.js');
const E = exports, reset = '\x1b[0m', green = '\x1b[32m', red = '\x1b[31m';
let tables;

const exec_and_record = (hdr, fn, file, params, opt)=>r_exec(fn, file, params, {
    ...opt,
    log: d=>console.log(`[${hdr}]`, d),
})

const check_code_style = ()=>etask(function* (){
    let zlint = yield exec_and_record('code style', {
        cmd: ['zlint', '-cm'], opt: {cwd: get_zon_root(process.cwd()),}
    }, 'zlint', 'cm');
    zlint = zlint.stdall.split('\n').filter(x=>!x.endsWith(': OK')).join('\n');
    if (zlint)
    {
        console.error(red+zlint+reset);
    }
});

class TestRun {
    cmd;
    cwd;
    relative;
    grep;
    time;
    header_fn;
    timeout;

    constructor(cmd, cwd, relative, grep, time, header_fn, timeout){
        this.cmd = cmd;
        this.cwd = cwd;
        this.relative = relative;
        this.grep = grep;
        this.time = time;
        this.header_fn = header_fn;
        this.timeout = timeout;
    }

    run(){
        if (!this._e_run)
        {
            let self = this;
            this._e_run = etask(function*(){
                this.finally(()=>{
                    self._e_run = null;
                });
                if (self.timeout > 0)
                    this.alarm(self.timeout, self.cancel.bind(self));
                let res = yield r_exec({
                    cmd: self.cmd,
                    opt: {
                        cwd: self.cwd,
                        env: process.env,
                        encoding: 'utf8',
                    },
                }, self.relative, self.grep, {
                    time: self.time,
                    log: txt=>console.log(self.header_fn(), txt),
                });
                let err_msg = res?.retval && res.stderr.substring(res.stderr.indexOf('CRIT: '));
                let print = err_msg ? console.error : console.log;
                let msg = err_msg ? red+self.header_fn()+'\n'+err_msg+reset
                    : green+self.header_fn()+' '+reset+'\n';
                print(msg);
                return !!err_msg;
            });
        }
        return this._e_run;
    }

    cancel(){
        if (typeof this._e_run?.return == 'function')
        {
            console.log(this.header_fn(), 'is canceled\n');
            this?._e_run?.return(false);
        }
    }
}

const run_files = etask.fn(function*(files, opt){
    let tests = [], failed = [], current_i = 0, current_test;
    let i = 0, j = 0;
    for (let file of files)
    {
        i++;
        j = 0;
        const greps = opt.separate ? yield scan_for_test_descriptions(file)
            : ['.+'];
        for (let grep of greps)
        {
            j++;
            const cmd = ['zmocha', '-T', path.basename(file), '-g', grep, '-t', 60000];
            const cwd = path.dirname(file);
            const relative = get_zon_relative(file);
            if (Array.isArray(opt?.mocha_opt))
                cmd.push(...opt.mocha_opt);
            const success = yield tables.exec_time
                .avg({file: relative, params: grep});
            let header_fn = ()=>sprintf(`[%s/%s] %s: %s`, current_i+1,
                tests.length, relative, grep);
            tests.push(new TestRun(cmd, cwd, relative, grep,
                Number.isFinite(success) ? success : 0, header_fn,
                opt['max-test-time']));
        }
    }
    console.log(nl2jn`Founded ${tests.length} tests, will took 
    ${fmt_num(tests.reduce((p, c)=>p+c.time, 0), 'time')}`);
    tests = _.sortBy(tests, x=>x.time);
    pipe_lines(lines=>{
        for (let line of lines)
        {
            switch (line.toLowerCase().trim())
            {
            case 'skip':
                current_test?.cancel();
                return;
            }
        }
    });

    for (current_i = 0; current_i<tests.length; current_i++)
    {
        current_test = tests[current_i];
        if (yield current_test.run())
            failed.push(current_test.relative);
    }
    return failed;
});

const run = {
    command: '$0',
    describe: 'Runs tests near changed files, check code style',
    builder: yargs=>yargs
        .option('separate', {
            desc: 'Run each test case separately',
        })
        .option('skip-release', {
            desc: 'Skip build release step',
        })
        .option('skip-file2host', {
            desc: 'Skip detecting which server we need to release',
        })
        .option('max-test-time', {
            desc: 'Max running test time for single test/describe.',
            type: 'number',
            default: -1,
        })
        .option('test-type', {
            desc: 'Test type to run',
            type: 'string',
            choices: ['mocha', 'selenium'],
            default: 'mocha'
        }),
    handler: (opt)=>etask(function*(){
        this.on('uncaught', console.error.bind(console));
        this.finally(process.exit);

        if (!process.env.BUILD)
        {
            return console.error('Use sb to select build');
        }

        tables = yield _tables();

        let zroot = get_zon_root(process.cwd());

        yield exec_and_record('cvsup refresh', {
            cmd: ['cvsup'], opt: {cwd: zroot}
        }, 'cvsup');

        let file2host = !opt['skip-file2host'] && exec_and_record('file2host'
            +' - releasing hosts', {
            cmd: ['node', 'system/scripts/file2host.js', '--cache'],
            opt: {cwd: path.join(zroot, 'pkg'), stdall: true}
        }, 'file2host');

        if (!opt['skip-release'])
        {
            yield exec_and_record('building new release', {
                cmd: ['jmake', 'cm', 'release'],
                opt: {cwd: zroot,}
            }, 'jmake', 'cm release', {should_throw: true});
        }

        yield check_code_style();
        let files = yield find_test_files(zroot, {test_type: opt['test-type']});
        let failed = yield run_files(files, opt);
        if (failed.length)
        {
            console.error(`${failed.length} tests failed:\n${failed.join('\n')}`);
        }

        if (file2host)
        {
            file2host = yield file2host;
            file2host = file2host.stdout.split('\n');
            let index = file2host.findIndex(x=>x.includes('changes on'));
            if (index<0)
                console.log('no releasing servers');
            else
            {
                file2host = file2host.slice(index).join('\n');
                file2host = file2host.slice(
                    file2host.indexOf('['),
                    file2host.indexOf(']')+1,
                ).replace(/'/g, `"`);
                let arr = JSON.parse(file2host);
                let cmd = arr.map(x=>'deploy -ds '+x).join(' && ');
                console.log('Write this to ask the release:\n', cmd);
            }
        }

        console.log('DONE');
    }),
}

yargs_root.scriptName('ztest')
    .command(run)
    .completion('bash_completion', false)
    .help()
    .demandCommand()
    .recommendCommands()
    .strict()
    .wrap(yargs_root.terminalWidth())
    .argv;