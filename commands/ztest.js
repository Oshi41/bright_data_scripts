const {zrequire, exec_and_record: r_exec, get_zon_root,
    find_test_files, get_zon_relative, scan_for_test_descriptions,
    tables: _tables} = require('../utils.js');
const path = require("path");
const yargs_root = require('yargs');
const fs = require('fs');
const etask = zrequire('../../util/etask.js');
const cli = zrequire('../../util/cli.js');
const E = exports, reset = '\x1b[0m', green = '\x1b[32m', red = '\x1b[31m';
let tables;

const exec_and_record = (hdr, fn, file, params, opt) => r_exec(fn, file, params, {
    ...opt,
    log: d => console.log(`[${hdr}]`, d),
})

const check_code_style = () => etask(function* () {
    let zlint = yield exec_and_record('code style', {
        cmd: ['zlint', '-cm'], opt: {cwd: get_zon_root(process.cwd()),}
    }, 'zlint', 'cm');
    zlint = zlint.stdall.split('\n').filter(x => !x.endsWith(': OK')).join('\n');
    if (zlint)
        console.error(red + zlint + reset);
});

const run_files = (files, opt) => etask(function* () {
    let failed = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const greps = opt.separate ? yield scan_for_test_descriptions(file)
            : ['.+'];
        for (let j = 0; j < greps.length; j++)
        {
            let grep = greps[j];
            const cmd = ['zmocha', '-T', path.basename(file), '-g', grep, '-t', 60000];
            const cwd = path.dirname(file);
            const relative = get_zon_relative(file);
            if (Array.isArray(opt?.mocha_opt))
                cmd.push(...opt.mocha_opt);
            const success = yield tables.exec_time
                .avg({file: relative, params: grep, success: true});
            let res = yield r_exec({cmd, opt: {
                    cwd, env: process.env, encoding: 'utf8',}
            }, relative, grep, {time: success});
            let header = [`[${i + 1}/${files.length}]`];
            if (greps.length > 1)
                header.unshift(`[${j + 1}/${greps.length}]`);
            header.push(`${relative}: ${grep} `)
            header = header.join(' ');
            let err_msg = res?.retval && res.stderr.substring(res.stderr.indexOf('CRIT: '));
            let print = err_msg ? console.error : console.log;
            let msg = err_msg ? red + '☒ ' + header + '\n' + err_msg + reset
                : green + '✓ ' + header + ' ' + reset;
            print(msg);

            if (err_msg)
                failed.push(relative);
        }

    }
    return failed;
});

const run = {
    command: '$0',
    describe: 'Runs tests near changed files, check code style',
    builder: yargs => yargs
        .option('separate', {
            desc: 'Run each test case separately',

        })
        .option('test_type', {
            desc: 'Test type to run',
            type: 'string',
            choices: ['mocha', 'selenium'],
            default: 'mocha'
        }),
    handler: (opt) => etask(function* () {
        this.on('uncaught', console.error.bind(console));

        if (!process.env.BUILD)
            return console.log('Use sb to select build');

        tables = yield _tables();

        let zroot = get_zon_root(process.cwd());

        yield exec_and_record('cvsup refresh', {
            cmd: ['cvsup'], opt: {cwd: zroot}
        }, 'cvsup');

        let file2host = exec_and_record('file2host - releasing hosts', {
            cmd: ['node', 'system/scripts/file2host.js'],
            opt: {cwd: path.join(zroot, 'pkg'), stdall: true}
        }, 'file2host');

        if (!opt.skip_release) {
            yield exec_and_record('building new release', {
                cmd: ['jmake', 'cm', 'release'],
                opt: {cwd: zroot,}
            }, 'jmake', 'cm release', {should_throw: true});
        }

        yield check_code_style();
        let files = yield find_test_files(zroot, {test_type: opt.test_type});
        let failed = yield run_files(files, opt);
        if (failed.length)
            console.error(`${failed.length} tests failed:\n${failed.join('\n')}`);

        file2host = yield file2host;
        file2host = file2host.stdout.split('\n');
        let index = file2host.findIndex(x => x.includes('changes on'));
        if (index < 0)
            file2host = ['no releasing servers'];
        else {
            file2host = file2host.slice(index);
            index = file2host.findIndex(x=>x.includes(']'));
            if (index >= 0)
                file2host = file2host.slice(0, index);
        }
        console.log(file2host.join('\n'));
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