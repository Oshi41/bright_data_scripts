const {zrequire, parse_cvs_status, exec_and_record: r_exec, tables} = require("./utils.js");
const etask = zrequire('../../util/etask.js');
const exec = zrequire('../../util/exec.js');
const keyring = zrequire('../../util/keyring.js');

const main = ()=>etask(function*(){
    exec.sys(['xdg-open', '/home/arkadii/1.html']);
    yield etask.sleep(1000 * 20);
    console.log('here');
});
main();