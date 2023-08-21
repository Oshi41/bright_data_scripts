const {zrequire, parse_cvs_status, exec_and_record: r_exec, tables} = require("./utils.js");
const etask = zrequire('../../util/etask.js');
const cli = zrequire('../../util/cli.js');
const exec = zrequire('../../util/exec.js');
const keyring = zrequire('../../util/keyring.js');
const mongodb = zrequire('../../util/mongodb.js');
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
    this.on('uncaught', e=>console.error('CRIT:', e));
    mongodb.add_conn_strs_to_env({mongo_schema, domain: 'brightdata.com'},
        ['slack_tokens']);
    let id = 'U0438TF2A78'; // arkadii
    let channel = 'D04LW45TLMC'; // with deploybot
    let {access_token} = yield mongodb.find_one('slack_tokens', {id});
    let api = new slack.WebClient(access_token);
    let res = yield api.chat.postMessage({
        channel,
        text: 'hi'
    });
    console.log(res);
});
main();