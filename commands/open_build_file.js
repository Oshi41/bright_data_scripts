const yargs_root = require('yargs');
const path = require('path');
const os = require('os');
const fs = require('fs');
const _ = require('lodash');
const {zrequire, get_zon_root} = require('../utils.js');
const {nl2jn, qw, align} = zrequire('../../util/string.js');
const etask = zrequire('../../util/etask.js');
const exec = zrequire('../../util/exec.js');
const presets = new Map([
    ['auto', 'xdg-open'],
    ['explorer', 'xdg-open'],
]);

const find_jb_script = program=>{
    let standalone = `/opt/webstorm/bin/${program}.sh`;
    if (fs.existsSync(standalone))
        return standalone;
    let scripts = path.join(os.homedir(), '.local/share/JetBrains/Toolbox/scripts');
    let from_scripts = path.join(scripts, program+'.sh');
    if (fs.existsSync(from_scripts))
        return from_scripts;
    let find = fs.readdirSync(scripts).find(x=>x.includes(program));
    if (find)
        return path.join(scripts, find);
}

const open_cmd = {
    command: '$0',
    args: '<filepath>',
    describe: nl2jn`Opens hardlink of file located in build folder, as debugger
        linked to it`,
    builder: yargs=>yargs
        .option('program', {
            alias: 'p',
            type: 'string',
            default: 'webstorm',
            describe: align`Which program you want to open file.
            webstorm - open file with WebStorm.
            idea - open file with IntellijIDEA
            auto - open with default program selector
            explorer - open in file manager`,
        })
        .option('line', {
            type: 'number',
            describe: 'On which line we want to open file, works only with '
                +'webstorm.sh for now',
        })
    ,
    handler: etask.fn(function*(opt){
        this.on('uncaught', e=>console.error('CRIT:', e));
        this.finally(process.exit);

        if (!process.env.BUILD)
            return console.error('Use sb to choose build');
        let filepath = path.resolve(opt._[0]);
        if (!fs.existsSync(filepath) || !fs.statSync(filepath)?.isFile())
            return console.error('Provide file you want to open');
        let root = get_zon_root(filepath);
        let relative = path.relative(root, filepath);
        let result = path.join(root, 'build.'+process.env.BUILD, relative);
        if (!fs.existsSync(result))
            return console.error(`Looks like this file is not exists: ${result}`);
        let script = path.isAbsolute(opt.program) ? opt.program :
            find_jb_script(opt.program) || presets.get(opt.program)
            || opt.program || 'xdg-open';
        if (opt.program == 'explorer')
            result = path.dirname(result);
        let args = [script];
        if (opt.line)
            args.push('--line', opt.line);
        args.push(result);
        exec.sys(args);
        yield etask.sleep(1000);
        console.log('DONE');
    }),
};

yargs_root
    .command(open_cmd)
    .completion('bash_completion', false)
    .help()
    .demandCommand()
    .recommendCommands()
    .wrap(yargs_root.terminalWidth())
    .argv;