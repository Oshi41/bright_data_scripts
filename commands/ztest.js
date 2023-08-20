const {
    zrequire, exec_and_record: r_exec, get_zon_root,
    find_test_files, get_zon_relative, scan_for_test_descriptions,
    tables: _tables, fmt_num, pipe_lines
} = require('../utils.js');
const path = require("path");
const yargs_root = require('yargs');
const fs = require('fs');
const etask = zrequire('../../util/etask.js');
const {nl2jn} = zrequire('../../util/string.js');
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
    header;

    constructor(cmd, cwd, relative, grep, time, header){
        this.cmd = cmd;
        this.cwd = cwd;
        this.relative = relative;
        this.grep = grep;
        this.time = time;
        this.header = header;
    }

    run(){
        if (!this._e_run)
        {
            let self = this;
            this._e_run = etask(function*(){
                this.finally(()=>{
                    self._e_run = null;
                });
                let res = yield r_exec({
                    cmd: self.cmd,
                    opt: {
                        cwd: self.cwd,
                        env: process.env,
                        encoding: 'utf8',
                    },
                }, self.relative, self.grep, {
                    time: self.time,
                    log: txt=>console.log(`[${self.header}]`, txt),
                });
                let err_msg = res?.retval && res.stderr.substring(res.stderr.indexOf('CRIT: '));
                let print = err_msg ? console.error : console.log;
                let msg = err_msg ? red+'☒ '+self.header+'\n'+err_msg+reset
                    : green+'✓ '+self.header+' '+reset;
                print(msg);
                return !!err_msg;
            });
        }
        return this._e_run;
    }

    cancel(){
        if (this._e_run)
        {
            this?._e_run?.return(false);
            console.debug(this.header, 'is canceled');
        }
    }
}

const run_files = etask.fn(function*(files, opt){
    const tests = [], failed = [];
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
                .avg({file: relative, params: grep, success: true});
            let header = [`[${i}/${files.length}]`];
            if (greps.length>1)
            {
                header.unshift(`[${j}/${greps.length}]`);
            }
            header.push(`${relative}: ${grep} `)
            header = header.join(' ');
            tests.push(new TestRun(cmd, cwd, relative, grep,
                Number.isFinite(success) ? success : 0, header));
        }
    }
    console.log(nl2jn`Founded ${tests.length} tests, will took 
    ${fmt_num(tests.reduce((p, c)=>p+c.time, 0), 'time')}`);
    let current_test, prev;
    pipe_lines(lines=>{
        for (let line of lines)
        {
            switch (line.toLowerCase().trim())
            {
            case 'skip':
                (prev || current_test)?.cancel();
                return;
            }
        }
    });
    for (let test of tests)
    {
        prev = current_test;
        current_test = test;
        let res = yield current_test.run();

        if (res)
            failed.push(current_test.relative)
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
        .option('test-type', {
            desc: 'Test type to run',
            type: 'string',
            choices: ['mocha', 'selenium'],
            default: 'mocha'
        }),
    handler: (opt)=>etask(function*(){
        this.on('uncaught', console.error.bind(console));

        if (!process.env.BUILD)
        {
            return console.log('Use sb to select build');
        }

        tables = yield _tables();

        let zroot = get_zon_root(process.cwd());

        yield exec_and_record('cvsup refresh', {
            cmd: ['cvsup'], opt: {cwd: zroot}
        }, 'cvsup');


        let file2host = !opt['skip-file2host'] && exec_and_record('file2host'
            +' - releasing hosts', {
            cmd: ['node', 'system/scripts/file2host.js'],
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
            {
                file2host = ['no releasing servers'];
            } else
            {
                file2host = file2host.slice(index);
                index = file2host.findIndex(x=>x.includes(']'));
                if (index>=0)
                {
                    file2host = file2host.slice(0, index);
                }
            }
            console.log(file2host.join('\n'));
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