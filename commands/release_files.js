#!/usr/bin/env node
const yargs_root = require('yargs');
const path = require('path');
const os = require('os');
const fs = require('fs');
const _ = require('lodash');
const {zrequire, get_zon_root} = require('../utils.js');
const {nl2jn, qw, align} = zrequire('../../util/string.js');
const etask = zrequire('../../util/etask.js');
const exec = zrequire('../../util/exec.js');

const print = {
    command: '$0',
    describe: nl2jn`Prints all files related to release`,
    builder: yargs=>yargs
        .option('server', {
            describe: 'Server name',
            alias: 's',
            type: 'string',
            array: true,
        })
        .option('regex', {
            describe: 'Regexp search',
            alias: 'r',
            type: 'string',
        })
        .option('find', {
            describe: 'Text search',
            alias: 'f',
            type: 'string',
        })
    ,
    handler: etask.fn(function*(opt){
        this.on('uncaught', e=>console.error('CRIT:', e));
        this.finally(process.exit);

        let root = get_zon_root(process.cwd());
        let cache_file = path.join(root, 'pkg', 'file2host.json');
        if (!fs.existsSync(cache_file))
        {
            let res = yield exec.sys(['node', 'system/scripts/file2host.js', '--cache'],
            {
                cwd: path.join(root, 'pkg'),
                env: process.env,
                stdall: 'pipe',
                encoding: 'utf8',
                log: () => {
                },
            });
            if (res.retval)
                return console.error(res.stderr.toString());
        }
        if (!fs.existsSync(cache_file))
            return console.error('Cache file is not found:', cache_file);
        let raw = fs.readFileSync(cache_file, 'utf-8');
        let json = JSON.parse(raw);
        if (!opt.server?.length)
            return console.log('Select at least one server');
        let regexp, servers = opt.server.map(x=>x.toLowerCase());
        let map = new Map(servers.map(x=>[x, []]));
        const filter = txt=>{
            if (opt.find)
                return txt.includes(opt.find);
            if (opt.regex)
            {
                regexp = regexp || new RegExp(opt.regex);
                return regexp.test(txt);
            }
            return true;
        }
        for (let [filepath, arr] of Object.entries(json))
        {
            filepath = path.join(root, 'pkg', filepath);
            if (!filter(filepath))
                continue;
            for (let srv of _.intersection(arr, servers))
            {
                map.get(srv).push(filepath);
            }
        }
        for (let [srv, files] of map)
        {
            console.log(`[${srv}], ${files.length} files`);
            console.log(files.sort().join('\n')+'\n');
        }
    }),
}

yargs_root
    .command(print)
    .completion('bash_completion', false)
    .help()
    .demandCommand()
    .recommendCommands()
    .wrap(yargs_root.terminalWidth())
    .argv;