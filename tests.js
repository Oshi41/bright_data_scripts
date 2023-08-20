const {zrequire, parse_cvs_status, exec_and_record: r_exec, tables} = require("./utils.js");
const etask = zrequire('../../util/etask.js');
const cli = zrequire('../../util/cli.js');
const exec = zrequire('../../util/exec.js');
const keyring = zrequire('../../util/keyring.js');

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
    let stdin = process.openStdin();
    pipe_lines(lines=>{
        console.log('Caught user imput')
    });
    for (let i = 0; i<10; i++)
    {
        yield etask.sleep(1000);
        console.log('HERE', i+1)
    }
});
main();