const path = require('path');
const os = require('os');
const fs = require('fs');
const {zrequire, parse_cvs_status, exec_and_record: r_exec, tables,
t: {load_all_zon_dirs}, zon_n_require} = require("./utils.js");
const etask = zrequire('../../util/etask.js');
const cli = zrequire('../../util/cli.js');
const exec = zrequire('../../util/exec.js');
const keyring = zrequire('../../util/keyring.js');
const {align} = zrequire('../../util/string.js');
const mongodb = zrequire('../../util/mongodb.js');
const mail = zrequire('../../util/mail.js');
const date = zrequire('../../util/date.js');
const nodemailer = require('nodemailer');
const mongo_schema = zrequire('../../system/db/local.js').use('mongo_schema');
const slack = require('@slack/web-api');

const standalone_webstorm = '/opt/webstorm/bin/webstorm.sh';
const toolbox_scripts = path.join(os.homedir(), '.local/share/JetBrains/Toolbox/scripts');

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


const main = ()=>etask(function*(){
    this.finally(process.exit);
    this.on('uncaught', e=>console.error('CRIT:', e));
    let paths = process.env.PATH?.split(':');
    console.log(paths);

    let all = load_all_zon_dirs();
    let r = zon_n_require();
    console.log(all);
});
main();