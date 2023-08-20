#!/usr/bin/env node
const nedb = require('nedb');
const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const zrequire = str => require(path.resolve('/usr/local/hola/system/scripts/', str));
zrequire('../../util/config.js');
const etask = zrequire('../../util/etask.js');
const exec = zrequire('../../util/exec.js');
const conv = zrequire('../../util/conv.js');
const E = exports, dbs = {}, reset = '\x1b[0m', green = '\x1b[42m', yellow = '\x1b[43m';

E.db_folder = path.join(require('os').homedir(), '_database');
let init_et, sync;
const find = (db, q, proj = null, sync_et = null) => etask(function* () {
    sync_et && (yield sync_et);
    let _this = sync_et = this;
    this.finally(() => sync_et = null);
    let args = [q, proj].filter(Boolean)
    db.find(...args, (err, docs) => {
        if (err)
            _this.throw(err);
        _this.return(docs);
    })
    yield this.wait();
});
const insert = (db, doc, sync_et = null) => etask(function* () {
    sync_et && (yield sync_et);
    let _this = sync_et = this;
    this.finally(() => sync_et = null);
    db.insert(doc, (err, docs) => {
        if (err)
            _this.throw(err);
        _this.return(docs);
    })
    yield this.wait();
});
const count = (db, q, sync_et = null) => etask(function* () {
    sync_et && (yield sync_et);
    let _this = sync_et = this;
    this.finally(() => sync_et = null);
    db.count(q, (err, count) => {
        if (err)
            _this.throw(err);
        _this.return(count);
    })
    yield this.wait();
});
const remove = (db, q, sync_et = null) => etask(function* () {
    sync_et && (yield sync_et);
    let _this = sync_et = this;
    this.finally(() => sync_et = null);
    db.remove(q, (err, count) => {
        if (err)
            _this.throw(err);
        _this.return(count);
    })
    yield this.wait();
});

/**
 * @typedef {Object} exec_time
 * @property {Date} date - Execution start timestamp
 * @property {Number} time  - running time
 * @property {string} file - relative zon path / exec file name
 * @property {string?} params - run params / test grep / etc
 * @property {boolean?} success - run was successful
 * @property {string?} error - possible error
 */

/**
 * @typedef {Object} ignored_test
 * @property {string} file - relative zon path
 * @property {string?} reason - why we add to ignore
 */

/**
 * @typedef {Object} test_case
 * @property
 */

/**
 *
 * @return {{
 *     exec_time: {
 *         add: (exec_time)=>void,
 *         avg: (exec_time)=>number
 *     },
 *     ignored_tests: {
 *          add: (ignored_test)=>void,
 *          search_ignored: ([])=>string[],
 *     }
 * }}
 */
E.tables = () => etask(function* () {
    yield init_et;

    if (_.isEmpty(dbs)) {
        // init
        init_et = this;

        this.finally(() => {
            init_et = null
        });
        this.on('uncaught', e => console.error(e));

        if (!fs.existsSync(E.db_folder))
            fs.mkdirSync(E.db_folder);

        let ensure_index = (db, opt) => etask(function* () {
            let _this = this;
            db.ensureIndex(opt, err => {
                if (err)
                    throw err;
                _this.continue();
            });
            yield this.wait();
        });
        let create_db = opt => etask(function* () {
            let _this = this;
            let db = new nedb(Object.assign(opt, {
                autoload: true, onload: err => {
                    if (err)
                        throw err;
                    _this.continue();
                }
            }));
            yield this.wait();
            return db;
        });

        dbs.exec_time = yield create_db({filename: path.join(E.db_folder, 'exec_time.jsonl')});
        dbs.test_case = yield create_db({filename: path.join(E.db_folder, 'test_case.jsonl')});
        dbs.ignored_tests = yield create_db({filename: path.join(E.db_folder, 'ignored.jsonl')});

        yield ensure_index(dbs.exec_time, {fieldName: 'error', sparse: true});
        yield ensure_index(dbs.exec_time, {fieldName: 'params', sparse: true});
        yield ensure_index(dbs.exec_time, {fieldName: 'time'});
        yield ensure_index(dbs.exec_time, {fieldName: 'date'});
        yield ensure_index(dbs.exec_time, {fieldName: 'file'});

        yield ensure_index(dbs.test_case, {fieldName: 'file'});
        yield ensure_index(dbs.test_case, {fieldName: 'revision'});
        yield ensure_index(dbs.test_case, {fieldName: 'description', sparse: true});
        yield ensure_index(dbs.test_case, {fieldName: 'name', sparse: true});

        yield ensure_index(dbs.ignored_tests, {fieldName: 'file', sparse: true});

        let {exec_time, test_case, ignored_tests} = dbs;

        // Public API
        dbs.exec_time = {
            add: opt => insert(exec_time, opt, sync),
            find: opt=>find(exec_time, opt),
            avg: opt => etask(function* () {
                let docs = yield find(exec_time, opt, {time: 1});
                let sum = docs.map(x=>x.time).reduce((p, c) => p+c, 0);
                return sum / docs.length;
            }),
        };
        // dbs.test_case = {
        //     add: opt => insert(inner_db.test_case, opt),
        //     exists: opt => etask(function* () {
        //         return ((yield count(inner_db.test_case, opt)) > 0);
        //     }),
        //     replace: arr => etask(function* () {
        //         if (!arr?.length)
        //             return false;
        //         yield etask.all(_.uniq(arr.map(x => ({file: x.file})))
        //             .map(x => remove(inner_db.test_case, x, {multi: true})));
        //         for (let c of arr)
        //             yield insert(inner_db.test_case, c);
        //     }),
        // };
        dbs.ignored_tests = {
            add: opt => insert(ignored_tests, opt),
            search_ignored: arr => etask(function* () {
                arr = Array.isArray(arr) ? arr : [arr];
                if (!arr.length)
                    return [];
                let res = yield find(ignored_tests, {file: {$in: arr}});
                return res.map(x => x.file);
            }),
        };
    }
    return dbs;
});

const time_map = new Map([
    ['day', 1000 * 60 * 60 * 24],
    ['hour', 1000 * 60 * 60],
    ['min', 1000 * 60],
    ['sec', 1000],
]);
E.fmt_num = (num, unit_or_opt, opt) => {
    if (unit_or_opt == 'time') {
        let res = num;
        for (let [name, multiplier] of time_map) {
            if (multiplier <= Math.abs(res)) {
                return conv.fmt_num(res / multiplier) + ' ' + name;
            }
        }
        return conv.fmt_num(res) + ' mls';
    } else {
        return conv.fmt_num(num, unit_or_opt, opt);
    }
}

/**
 * Searches zon root folder
 * @param filepath - file or folder inside zon dir
 * @return {undefined|*|string}
 */
E.get_zon_root = filepath => {
    if (fs.existsSync(filepath) && filepath != '/') {
        if (fs.lstatSync(filepath)?.isDirectory()) {
            const cvs_path = path.resolve(filepath, 'CVS', 'Repository');
            if (fs.existsSync(cvs_path)) {
                const first_line = fs.readFileSync(cvs_path, 'utf8').split('\n')[0];
                if (first_line == 'zon') {
                    return filepath + '/';
                }
            }
        }
        return E.get_zon_root(path.dirname(filepath));
    }
    return undefined;
};

E.get_zon_relative = filepath => {
    return path.relative(E.get_zon_root(filepath), filepath);
}

/**
 *
 * @param fn {etask | {cmd: Array, opt: Object}} - etask func or args to exec.sys
 * @param file {string} - file name
 * @param params {string} - params/test describe
 * @param log {Function}- log function (console.log by default)
 * @param time - avg success time
 * @param should_throw {boolean}
 * @return {*} - async func return
 */
E.exec_and_record = (fn, file, params = '', {
    log = console.log, time, should_throw
} = {}) => etask(function* () {
    let start = new Date(), err;
    const {exec_time} = yield E.tables();
    if (log) {
        time = time || (yield exec_time.avg({file, params}));
        if (time) {
            log?.(`~ ` + E.fmt_num(time, 'time'));
        }
    }
    try {
        if (typeof fn === 'function') {
            const res = yield fn();
            return res;
        }
        if (fn.cmd) {
            let opt = Object.assign({
                env: process.env,
                stdall: 'pipe',
                encoding: 'utf8'
            }, fn.opt);
            const res = yield exec.sys(fn.cmd, opt);
            if (res.retval) {
                err = new Error(res.stderr.toString());
            }
            return res;
        }
    } catch (e) {
        err = e;
        if (should_throw) {
            throw err;
        }
    } finally {
        let run_time = new Date() - start;
        yield exec_time.add({
            date: start,
            file,
            params: params,
            time: run_time,
            error: err,
            success: !err,
        });
        if (log) {
            const time = yield exec_time.avg({file, params});
            if (time) {
                let diff = time - run_time;
                let txt = 'Took ' + E.fmt_num(run_time, 'time');
                if (diff) {
                    txt += ', ' + (diff > 0 ? green + '+' : yellow) + E.fmt_num(diff, 'time');
                }
                log?.(txt + reset);
            }
        }
    }
});

/**
 * Parse cvs status for files
 * @param root {string}
 * @return {Map<string, {version: string, modified: boolean, relative_path: string}>}
 */
E.parse_cvs_status = (root) => E.exec_and_record(() => etask(function* () {
    root = E.get_zon_root(root);
    const res = yield exec.sys(['cvs', '-Q', 'status'], {
        cwd: root,
        env: process.env,
        stdall: 'pipe',
        encoding: 'utf8',
    });
    let lines = res.stdout.split('\n'), result = new Map();
    let r_name = /^File: (\S+)\s+Status:/, r_ver = /(\d+(\.\d+)+)/;
    let r_rel_file = /\/zon\/(.*),/;
    for (let i = 0; i < lines.length; i++) {
        let name = r_name.exec(lines[i])?.[1];
        if (name) {
            let rel_path = r_rel_file.exec(lines[i + 3])?.[1];
            if (!rel_path) {
                continue;
            }
            if (rel_path.includes('Attic')
                && !rel_path.toLowerCase().endsWith('.rcs'))
            {   // locally modified file
                rel_path = rel_path.replace('Attic/', '');
            }
            let upd = obj => {
                let key = path.join(root, rel_path);
                let source = result.get(key) || {}
                result.set(key, Object.assign(source, obj));
            };
            if (lines[i].includes('Locally')) {
                upd({modified: true});
            }
            let work_rev = r_ver.exec(lines[i + 2])?.[1];
            if (work_rev) {
                upd({version: work_rev});
            }
        }
    }
    return result;
}), 'cvs', '-Q status root', {log: data => console.log(`[CVS check]`, data)});

/**
 * Returns test type for file if present
 * @param file {string}
 * @return {'mocha' | 'selenium' | undefined}
 */
E.get_test_type = (file) => {
    if (fs.statSync(file)?.isFile()) {
        let txt = fs.readFileSync(file, 'utf8');
        const is_test = [/\ndescribe\(/g, / describe\(/g].some(x=>x.test(txt));
        if (is_test)
            return txt.includes('selenium.') ? 'selenium' : 'mocha';
    }
}

E.find_test_files = (root, {test_type, spinner}) => etask(function* () {
    root = E.get_zon_root(root);
    let files = yield E.parse_cvs_status(root);
    spinner?.('cvs checked');
    let changed = new Map(Array.from(files.entries()).filter(x => x[1].modified));
    console.log('\n', `Changed files: [${Array.from(changed.keys()).join(', ')}]`);
    let result = [];
    let dirs = _.uniq(Array.from(changed.keys()).map(x => path.dirname(x)));
    for (let dir of dirs) {
        for (let file of fs.readdirSync(dir).map(x => path.join(dir, x))) {
            if (E.get_test_type(file) == test_type)
                result.push(file);
        }
    }
    const {ignored_tests} = yield E.tables();
    const ignored = yield ignored_tests.search_ignored(result);
    result = result.filter(x => !ignored.includes(x));
    return result;
});

/**
 * @param abs_path {string}
 * @return {Map<string, {cases: string[], children: [], desc: string}>}
 */
E.scan_for_test_descriptions = (abs_path) => etask(function* () {
    this.on('uncaught', e => console.error(e));
    let res = yield exec.sys(['zmocha', '-P', abs_path], {
        cwd: path.dirname(abs_path),
        env: process.env,
        stdall: 'pipe',
        encoding: 'utf8',
    });
    let map = new Map();
    if (!res.retval) {
        /**
         * @param arr {string[]} - zmocha lines print run
         * @param index {number}
         * @return {Map<string, {desc: string, cases: string[], children: object[]}>}
         */
        const parse_describe = (arr, index) => {
            let describe_name = arr[index];
            const get_space_count = (line)=>{
                return '* -'.split(' ')
                    .map(x => line.indexOf(x))
                    .find(x => x >= 0);
            }

            let spaces_amount = get_space_count(describe_name);
            let describe = {desc: describe_name.substring(spaces_amount+2).trim(),
                cases: [], children: []};
            map.set(describe_name, describe);
            if (Number.isFinite(spaces_amount))
            {
                for (let i = index+1; i < arr.length; i++)
                {
                    let ln = arr[i], s_count = get_space_count(ln) ;
                    if (s_count == spaces_amount+4)
                    {
                        if (ln.includes('*'))
                        {
                            parse_describe(arr, i);
                            describe.children.push(map.get(ln));
                        }

                        if (ln.includes('-'))
                            describe.cases.push(ln.substring(s_count+2).trim());
                    }
                    else if (s_count < spaces_amount)
                        break;
                }
            }
        };
        const arr = res.stdall.toString().split('\n');
        let i = arr.findIndex(x=>x.includes('* (root)'));
        parse_describe(arr, i);
    }

    if (!map.size)
        return [];

    return _.uniq(Array.from(map.values()).flatMap(x=>x.cases));
});

E.zrequire = zrequire;