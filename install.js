#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const bash_path = path.join(os.homedir(), '.bashrc');

const main = ()=>{
    const map = new Map();
    let dir = path.resolve('commands');
    for (let basename of fs.readdirSync(dir))
    {
        let file = path.join(dir, basename);
        let alias = 'alias '+path.basename(file, path.extname(file));
        map.set(alias, alias+`="node ${file}"`);
    }
    let lines = fs.readFileSync(bash_path, 'utf-8').split('\n');
    let keys = Array.from(map.keys());
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let key = keys.find(x=>line.includes(x));
        if (key)
        {
            lines[i] = map.get(key);
            map.delete(key);
        }
    }
    for (let [, alias] of map) {
        lines.push(alias);
    }
    fs.writeFileSync(bash_path, lines.join('\n'), 'utf-8');
    console.log('DONE');
};

if (!module.parent)
    main();