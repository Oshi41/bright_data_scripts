const {zrequire, parse_cvs_status, exec_and_record: r_exec, tables} = require("./utils.js");
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

const pipe_lines = cb=>etask(function*(){
    let stdin = process.openStdin();
    let data = [], finished, _this = this;
    let process_lines = ()=>etask(function*(){
        let lines = Buffer.concat(data).toString().split('\n');
        try { yield cb(lines); }
        catch(e){ _this.throw(e); }
    });
    let finalize = ()=>etask(function*(){
        yield process_lines();
        _this.continue();
    });
    stdin.on('data', chunk=>etask(function*(){
        let idx = chunk.lastIndexOf('\n');
        if (idx<0)
            return void data.push(chunk);
        data.push(chunk.subarray(0, idx));
        stdin.pause();
        yield process_lines();
        data = [chunk.subarray(idx+1)];
        stdin.resume();
        if (finished)
            finalize();
    }));
    stdin.on('end', ()=>{
        finished = true;
        if (!stdin.isPaused())
            finalize();
    });
    yield this.wait();
});

const main = ()=>etask(function*(){
    this.finally(process.exit);
    this.on('uncaught', e=>console.error('CRIT:', e));
    let fp = '/home/arkadii/invoice.11.pdf';
    let from = process.env.USER;
    keyring.init();
    let pass = keyring.get('mongo:'+from);
    const transporter = nodemailer.createTransport({
        host: "smtp.brightdata.com",
        port: 587,
        tls: {},
        auth: {user: from, pass,},
    });
    const email = {
        from: from+'@brightdata.com',
        to: `${from}@brightdata.com; ${from}@brightdata.com`,
        subject: 'Invoice / '+date.strftime('%B %Y', date()),
        html: 'Hi, attaching invoice for '+date.strftime('%B', date()),
        attachments: [
            {
                filename: from+'_11_invoice.pdf',
                path: fp
            }
        ],
    };
    let res = yield transporter.sendMail(email);
    console.log(res);
    yield mail.send(email);
    console.log()
});
main();