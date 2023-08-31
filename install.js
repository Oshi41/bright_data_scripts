#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const main = ()=>{
    let dir = path.resolve('commands');
    for (let basename of fs.readdirSync(dir))
    {
        let file = path.join(dir, basename);
        let alias = path.basename(file, path.extname(file));
        let hardlink = path.join(os.homedir(), '.local/bin', alias);
        if (fs.existsSync(hardlink))
            fs.rmSync(hardlink);
        fs.symlinkSync(file, hardlink, );
    }
    console.log('DONE');
};

if (!module.parent)
    main();