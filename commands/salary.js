const yargs_root = require('yargs');
const path = require('path');
const os = require('os');
const fs = require('fs');
const _ = require('lodash');
var easyinvoice = require('easyinvoice');
const {zrequire, approval} = require('../utils.js');
const etask = zrequire('../../util/etask.js');
const date = zrequire('../../util/date.js');
const wget = zrequire('../../util/wget.js');
const exec = zrequire('../../util/exec.js');
const {nl2jn, qw} = zrequire('../../util/string.js');
const keyring = zrequire('../../util/keyring.js');
const cli = zrequire('../../util/cli.js');
const username = process.env.USER;

const config_dir = path.join(os.homedir(), '_billing_info');
if (!fs.existsSync(config_dir))
{
    fs.mkdirSync(config_dir);
}

const get_date = (_date, add = undefined)=>{
    _date = date(_date);
    if (add)
    {
        _date = date.add(_date, add);
    }
    return date.strftime('%d-%b %Y', _date);
};

class File_keyring extends keyring.File_keyring {
    constructor(pass){
        super({});
        this.dir = config_dir;
        if (!pass)
        {
            keyring.init();
            let user = 'mongo:'+process.env.USER;
            pass = keyring.get(user);
            if (!pass)
            {
                throw new Error('use mongo_login for password')
            }
        }
        this.k = this.sha1(pass).slice(0, 32);
    }

    save_billing(data){
        this.set('billing', JSON.stringify(data));
    }

    get_billing(){
        let res = new Billing();
        let txt = this.get('billing');
        if (txt)
        {
            let dto = JSON.parse(txt);
            Object.assign(res, dto);
        }
        return res;
    }
}

class Billing {
    signature;
    contract_start;
    country;
    city;
    zip;
    address;
    card_number;
    bank_name;
    branch_name;
    branch_code;
    swift;
    last_invoice_num;
    products = [];
}

const bill = {
    command: 'bill',
    describe: 'prepare monthly salary bill',
    builder: yargs=>yargs
        .option('per_hour', {
            describe: 'Dollars per hour',
            default: 1,
        })
        .option('per_month', {
            describe: 'Additional payment per month',
            default: 250,
        }),
    handler: ()=>etask(function*(){
        let fk = new File_keyring();
        let billing = fk.get_billing();
        let sender = {
            company: billing.signature,
            country: billing.country,
            city: billing.city,
            address: billing.address,
            zip: billing.zip,
            custom1: billing.bank_name,
            custom2: `SWIFT: ${billing.swift}, ${billing.card_number}`,
        }
        if (billing.branch_name || billing.branch_code)
        {
            sender.custom3 = `Branch name/code: ${billing.branch_name}/${billing.branch_code}`;
        }
        let data = {
            sender,
            client: {
                company: "Bright Data Ltd.",
                address: "3 Hamachshev",
                zip: 4250714,
                city: "Netanya",
                country: "Israel",
                custom1: 'VAT ID 514114842',
            },
            information: {
                number: billing.last_invoice_num+1,
                date: get_date(date()),
                'due-date': get_date(date.add(date(), {day: 3})),
            },
            settings: {
                currency: 'USD',
            },
            products: [],
            images: {
                logo: 'iVBORw0KGgoAAAANSUhEUgAAAcsAAABuCAMAAAB/esicAAAAkFBMVEX///89f/zG2//D2f8vePw5ffz8/f/I3P9Jhvw2fPwzevz1+f+nv/37/P/p8f8rd/zm7/9glfy1zP7a5/94ov3x9f8kdPxPi/ySsv3M2v5qnP3k6/7T4//N3//U5P/e6v+auv19pv2/0/5MifyIrf1ilvy3zv5bj/yUtf2pxP17pP2Ts/1vn/0bcfyAqv2gvv0c50fDAAATLUlEQVR4nO2dC3eqOhOGReQWKmARbBXES5Xabev//3cHEMlMLiiK2q7Du9Z31rcLhJiHJJNkMun1Hi37/eGv7HQn7T+enYNOLakf7p+dhU7tSN9YyvzZmejUimyiaGbw7Fx0akOxqyhk+uxcdLpRev6fF6IoivtS/bvTn5T/mv1nbGUslUE2Lgl2z85Qp6sVmItepGg5S830epPtszPU6WoNN+57WqDMusz96jt+doY6XS17ZGklyrxmuqtnZ6jT1fJMBUgji2dn6H+h+1iYWxeyVKy7jEzseezcI90/J9vx/NVhmd7HKjmasFTrNgvddmbRdrEcTRT32TbV0LYD72lv14d2ou4+vzZZSQwGxH29x0sCE6NUtKiFVLOs+6uXt/ForbkDQjRNGzyNpZ4xTOZRbKhq/zmD5+3hZ2O6oUtIZpoUtsngLixjBqXitrH49aOEGUPL0pSTWXWf3NcrY+hHsZqrX8h4fB5yrQdEw4V8n9JYEZZlG4bshk1VIY9nqccVxP5TWaYaWxr3YbkdsIXexgBzarG5v4blbvmTaflxZcuoR31GV7IM5n6m4XUP9x7Hkq2XmuK3kGo7LE1SSHk2Sz+r3aphX/dw73EsfQW/SEuv//6oNgM2+1ewjE6f2bUsYVd5C8vjs9ez3Azc3P67O0v2o2lnruB1Ocpsb1g5SfM5+wMpW4qrrU87cGaZ+WPcxjJQb2QZeO+H5cjU7s5yyzSyLQ0v7cB/3Vs3sZxot7Islag3sUxuZXnUgtyd5XAKYbptLnlBu6o5Sz8sW33tySzjW9vYo17uz7LnrOlL3Fa98V5vYvmvzJZmPZflsYn9Gyx7Tjqw8ubMGpjtLkTfxNKpJqTIc1n6f4llz95N07W53uxanv9GLF8aPrwb/A6Wdmk5/RGWmQLHa38h4xaWNrWv3VtHSTex9NS/xvIuuoXljv7y8Kks4/69Wer2ZQ1P4DNZGHr+fF7jCasHZ0rOzoZs80wzUSJOMo9m1b9uYGnTJ5/Lkj57lqU+tAPbHsrACFk6q7fNKB1Nvw41c4RZkauH5WaibEDbaRvLdJ0ZOUv+fbrteO+7f/vRqGaRL5gf9unkaJSY6Wj8GQGgdvw2WpsKoaawjGUwWx0+Pz4Pr++O7Ie/gR8eyjMkVVasjud5TpCX7VmW+dpmkHPgrgTVtJGRXQdiMj50kiiOjb5hxHHkeyLuApb9seIW62AWIYPNTvDU0N8ulhvTPU4ckbSCuZq4RMvGa2SPcqIn6u7feFQ8YFmmlGX8Y4aksHi1fBkuz4G7Xp6WVVZpnriinWU5/5eS/E1Z9l1lLF5he4XODoOVWmmVyHIHZCfzuH96wojncb+Gpe74UXl3P54n2Gpwqimjfl9FClAScwPOFWaXBU0fx1JNQzgzZg0Urhc9fBfLv/SzLkvbGYflHy3KcvWzMcPjKml5u4zldhJyC1k5I3eSpx/sq8QlLI9jEu9lHcLFPCsc8++bf+A3DdxK3wtx7mD5x8xKFxXHcujM8YytqsbeqXACvy9LqA9Y5kkIbuCWKBiWzpRd1Mz+PGUM0AOziuWqxZ9js/oIAMuxy65oiFkmgjeX0sjIS0DiNSy9D4VLxjKxI4PzPra4VRb6aw/nScrKn2PpRCJYqnHk5Eg/CcBS9wzJXeqcaYYhS7KNTGHNGOF258DcdGQZg/UQwHLJpShiqb8qojdX6a0ntPRlLLP2wxDm3zLRx7gZ1L2K1LMc+rA0ORiIZQ1158hSjvLEsu7LYWsmZGktTfH3Skz0lJDlDC5tNWb5GYKH854u+4+stGUst1nGxFXbSuG7+MU+9FtrWQZVJSn6vnyJRLbmZdfV3759EUs7qrulr+IGE7JUpMWnEfgUxzLfJTJBvWxDlj/AEhlsXn3P8bdjV1LmEpbWx5r1YKA5hH3+DSyr0s86vZNJOnRAgVOWSS2Fflykhpc/OdvHwx2tytx/TEXC8lgmZDCghsrpF05B27wQsMTIGrL8gvdU3kCRpJWQsKTtgqaxtLQRsMavZ0nLFnc6Drd+iSulgEJepWwnV1I96zlQ2bei0gSMeZKPf+zA82H/iYxZliVZjxfb7WKvMeUIPRZ3jH3hxr0tvh3aPpwDAMfyFTSwA+DYNWO9McvEJSyP1Ii1TkfpmrFuBsD8SeWGj1Jr+wRVqbPjgRk7vqxqZT5k8RMnG1sGTgIBR3yq3OjvmErWmidwfmVIqzzuMTFLomzLxjRiHN20FLwpeU0JuOxGPba4KctobBGcFMvSgRlAQQ12+MGjcw5xpSyz8ejks/Bfd1Scf+jMMI+jKIrXkJ8aVYrlMxlV7eOGdh7L0i5BxokDCYHRpFr9Tc7SPibBvY7CRLYWYjmA0zVveOsAwZ6QzuuEspyzra4F5wqGK9zOMiz1Pb2qaSimQYCaw1OJx+I5vJz1B72EewJtxJbHBCQdXjQTWi5N9VV+lM6x7GV9qGokPJ0KZpVKDcssFXaG9KhqbkKFwxJsx8IpJh0T0FImPbq1gKwY9yzMMlMCW0uGpQ96N22C34GyMOD9ahFL8jVDFzewLWU3PgwRy0sCKZzsHlUQQoNnGaiRcPqwulM9lUIdS1vykVEbDOa8Zp0Ezj7n7Rcezehgm8iG7YFYlk4NS1h/yCfOM2pk2Ys9xo5l54DfQa44R87GLIdVXRCUL89Sl1DQT8lUXV0dS2lmTtUbjUrq1rxecZeDjQLIsiwWrejO8n0BTViuofcYU/Vi2M6zifYYlv+YizZsoS1mWrYxy8q8EUW24VlKlbDpXMOyNz+xhE1RHUsd/l62kdXx9i2NuGSz/Hx5WbwtR+b39GKWMXwHYbYNOWjMkXI/Fs0VvLFXoZce+5U0ZlnVBNG9DVhWzWNcFtFVLKu+Gw6OateiP1HFxKvvmKU1elsFJ3760H+9mCV0a+dawgB1xOtalhbHErXejDdQU5YUgWgVsAFLuxWWSWOWEWaJMopYDlb1+ahhibpEk1lwwvv9zIb1El1lOtumLLluDqkBy2F16y0svcYsHdTI4k8bsTy3mFvDEg0dTGyJ9gI4CjxTL3mWKuhtLcaXsyFLmzM/kRqw7LXLEn5a9f4+e9SOouJoi+UHsjbZeglZahuueatnGQGW5Adfa8iSzuMIC/walv1bWDrNWb5JJsx77bH8rO0v4XPWuNaO5Vn6sF5+4WsNWc6rAhf6nDRh2X8SywOeO4Eva4slegVrxyLbhzduzrBMIEsm4mkzlnRwKd6f/xdYon2w2gS5oLTEcls3teMhrxw+IEE9yxlcFGWilzRjWXWXffHe0cexPDopRkJTrJ5lhOZk0fJ8Wyzx+HKBnzPg+0O+eXsUSzrzJvbsuoBlHp8iD1ARX8tSDzyf2+/ZgCUsjay5uwdLdEnb4OdgA8y2krkexdKvWM6E1+tZDgMvMgzOo6QJy2EwN4SuQ5ezdO7PsrdB8/J4ChztrxSErHgUy8r0EQ9J6ljqgS9x27ucpZ3I/E0asLQhS8W6C0vk1Yc3qsPoaxa3atV7HMsqLoEq3hMjZ+nJvX4uZTn0GadM0M42YYnXMO/CEjeyJuwU0TyCyOr47SxnuEbi3u5CljPkEdSP/NxZJGlux2KW63vYsdkIE1VMEJ8Femm6QteNR7Gka79NWAagTqr9OJonM8cJGs4VVF11lsTcO+1MuGJMEqD+Mr3H+DKf3EGm7M+pYCFK8iUcoz+IpX4VSw/UyMiptpI0YqnP6ecAdx1cwdJDLDf3Ydnrf4OrClkv5nYvMH6ALyBhnRpK/WaWM1qh0N6PRiypAR2jq1ew9OVrwS2yZDc1ENfNg91RH0l3IzELHs/yYjuW+l9iCo1YUictdmG3OUs0Vr/P3HqhhXQvSY7SOsis9cf3l5eyrDwluQXPBixtmghz5QqWyDcKX26VZW8l3AhSkCQTefy8+rXoe9ixl8770F187OJOA5bVsJbz4ryCJXIsCNHvaJdlz/4UkrTCdFuzP/vhYxKht4+AJXWU437s5SyHshb2KpZfaHERXWqZZe/neOhFsftBK/5nkVAZ109WP6pe0oFBfNmaV1UteZcSlqXcb72ynniLqzlLG86vMfOh7bJ0jrG5rNFyk66zm831ZDRdREFNncz18Ln1virc9M+y1IXzMkddXi/n8pc2Z4k2dDCxHVplGWyOUNazfDlgliQzz7nE//hRLOkAXzwoYVk68hp1OUtd3udewfIdmbFyX+ebWZbbEBqHsHzY+uWpVC/03aIuJXzKF7OsHJoFDXtzlsgXh5nbbpPlR4nEFa8oyfUolsD4ucinkg7x+dHU5SxrOunGLIdwco0wq/otspyV1V9Tmh6Q2RbLs99QUt/IsixpT3dLvaTTd7e3sSqslqzTeIssT8shT2Ppnj0xlzqJcMP2XHKW5/tLqR1LWfK1uzHLEaTFOtu0x3JYWctu04h5bbFU2Uc5UdcOUcWUs2xgx7ITArS/5GcomrJUQVEQzp+xxXWSaj3kWbbPmdghubzaisnG3QLjUe5eKUv2I6F2LN9hNmSJtkkRrkdpkWVlLWvWrln0z+tZ6iPw67T0VCWC2af49BQd7Gjm6lrAxisAgSfYbkOXtrFc7aNTeOyloKEfHlwiFp0x0B5LWuQamb7E9lDHkqe7vZ4l2jNKpqvEn68OX6nlClzEisTAunKCswQWKkuWdDzKTr/Z1CJmWcJh5NCZByiMCKyzIMaQlCXaMAJRumwxefH2MIFl8bnbGvy+eno/YsnMywUwaIlF3NAykSb7t8WrcFinQz89wkX/hit22ojJHRP4JI+iVoRP4fZBnN5FWzy8mAi9B6o5PFVc2mh9umRJt73nkUSC/GCFKPcmSWAq2fdzAh1A9x8pS02p5rE9GO+eRTmyigNaoI6baK319IfZs2q/796mJgoxo1kkXe7eq4/Qrg/Skt2fv0/Zb5E1l7z+THDkGk3Z/Fud4lr6q7cUh4YhyuZtSznxwXBO9y2ELGFdy5eXndxdQ7eZuFgnlj4o7tg5/tShg8PflWWNPhLgmJX1kbBiqv0o8bwCc/4v4wzLPEDV2yqazd7fwBKUNvhkWrmJrOw1zQqZkki+CR98TtMI+aatxpusWJGswQTu6vwJCRfGxyKD8rAwO49pyV8O6Q4hVbrINpHEWcXRl1QjzlTG2jFoPN9cqLLlWKIk8WODca08pcsdPlS+IECYS9Ll/0tOD8W+X+FkPk8tK40whOEINYv7TqUsFf6rTkLJjSFlGcnuYUsZRln8ELMoT8G0xXkEu72GsuVvwm4crDTHLKiMgC5w5kFIh1zYLUohnp3+lh/hlYcJkYRSy83awBBe6nvgA1CrAdVBFqmsLD5i8vFX22bZG19UMYtyrno9Ccty04mk3YY798QJaOFUHuDHF5Z6fhAXqlvFNJ84kp06B+jKSGlM7SuvRUWPEghSKXpr+MJT9ryxVeOfYZFPgXtG6yzt0cUwq9HDzSwdk79FG6xrD3QUBblTIx0OH04sdQFMNatQuBoWc3wcMBDpl4uQqBoJ+1nR/M0OIzMzXNgQPVmnNjCXQvPRDF2pvpm95EmoifUNrWxkatVqcLLDzrWxRPRStKNWZWM5EjISRbGGCriiPcbpQpDLsYXfZ1XUNQf+5Thf6/WRkRPDGE+6B7Yw5FG4jomDFVU8aZW8v4zN3L4sYn0WIkRbv0g6jvi9Rswzs3QkVorHCFKzklP5gg9x41DuOrHH4rcu4DujCY3hmMc4Hb+f3zWne2CPTtY1luEqwQJn3zgNP4MIjh76pYk9BNXvNAcb+CendiNK2AX4PEB3kUDf8Kv4T/lxjUXqghBr2c/31e1u8fHztZ9Op1+H1UOPsY7LmYc8zrtC65EI1qLF176OtaKNCc39Tuz9IVC+U6dQBIrRM4o/xb4XiG7tR7PKOvbKMO3zBEbAtx1v5jmyjymP1M+cH5H9xQkuPKzigfL2ZeTf9c9+NDHTShOTuExQYG3d7rsdIwNw68kguYbc0QXHPwcchWxUGrTxxt+o+BSfm6jHDzA//+Eox4t2+Aha2bxMp9+gat+INRbfgEMnWucXqDo9SVFFKpQdJG1AmE84r73TZbJpoHZTehP00218nl6nR4kudVhL6U0w0FqrhmynFqVbl0BCEbTOOwF0eopWlFJN4wn39A7aPdq2U2v6uKheBrBe1s6YdnqabOB2w4aSBALeHlzMvE6/RHCdkchtH7inV27tdnqqIEv2EAQgsA9UEEG/06/QELrDSY8JCeCKaTeF90ulw1kAQSDKo8Dwkve26/Rb9A/6AY7EKziJAu5puhWs08OE/LbcheiWYE3rLretpdMvkgLFnjyRawWOTqwxdTs9X+hMC81aYo+H4XwPHJotPnp+p98kfBwlUT7oPkR/N4KuumTTdH9mp8fKZ9x6LDdU0s1+mprfLnL3DNnD1zr9OnEnLhZbSLhTjpVuTv0PKJYfOg460m4a9k9otqnfCWG5a3lMvE6/TKtRyDaqFUgymHbLXH9JevwxcYutrLRd1fKdteb0RXhYb6ffLOf9IzXzanhU1oeup4v3WTek/KNyknhV6j1KOowX6T8rznMAWtdfvQAAAABJRU5ErkJggg==',
            }
        };
        for (let {prod_name, price, fee} of billing.products)
        {
            if (fee)
            {
                data.products.push({
                    quantity: 1,
                    'tax-rate': 0,
                    description: nl2jn`${prod_name} 
                    ${date.strftime('%B %Y', date())} according to Contractor 
                    Agreement as of ${get_date(billing.contract_start)}`,
                    price,
                });
            }
            else
            {
                let from = date.nth_of_month(date.add(date(), {month: -1}), 26);
                let to = date.nth_of_month(date(), 26);
                let resp = yield wget(nl2jn`http://web
                .brightdata.com/att/report/api/user_report/${username}
                ?from_date=${get_date(from)}&to_date=${get_date(to)}`);
                let total_hours = +JSON.parse(resp.body)?.total_hours;
                to = date.nth_of_month(date(), 25); // excluding 26
                data.products.push({
                    'tax-rate': 0,
                    quantity: total_hours.toFixed(2),
                    description: nl2jn`${prod_name} since ${get_date(from)} 
                    to ${get_date(to)} according to Contractor Agreement as of 
                    ${get_date(billing.contract_start)}`,
                    price,
                });
            }
        }

        let result = yield easyinvoice.createInvoice(data);
        let f_path = path.join(os.homedir(), 'invoice.'
            +data.information.number+'.pdf');
        fs.writeFileSync(f_path, result.pdf, 'base64');
        console.log('Invoice', data.information.number, 'saved here:',
            f_path);
        exec.sys(['xdg-open', f_path]);
        if (approval('Please, check invoice and confirm if all ok'))
        {
            billing.last_invoice_num++;
            fk.save_billing(billing);
        }
    }),
};

const readline = (question, def, data_type)=>etask(function* (){
    this.finally(()=>{
        console.log('-'.repeat(20));
    });
    if (def)
        question += `\n(Current value - ${def})`;
    question += ':';
    while (true)
    {
        let value = (yield cli.get_input(question))?.trim() || def;
        switch (data_type)
        {
        case 'positive':
            value = +value;
            if (Number.isFinite(value) && value>0)
                return value;
            console.log('Enter positive number');
            break;

        case 'positive_int':
            value = +value;
            if (Number.isInteger(value) && value>0)
                return value;
            console.log('Enter positive integer');
            break;

        case 'string':
            if (value?.length)
                return value;
            console.log('Enter not empty string');
            break;

        case 'date':
            if (date.is_date_like(value))
                return date(value);
            console.log('Enter correct date');
            break;

        case 'nul_str':
            value = value?.trim();
            if (!value)
                return undefined;
            return value;
        }
    }
});

const codes_upper_code = {
    AED: 'د.إ',
    AFN: '؋',
    ALL: 'L',
    AMD: '֏',
    ANG: 'ƒ',
    AOA: 'Kz',
    ARS: '$',
    AUD: '$',
    AWG: 'ƒ',
    AZN: '₼',
    BAM: 'KM',
    BBD: '$',
    BDT: '৳',
    BGN: 'лв',
    BHD: '.د.ب',
    BIF: 'FBu',
    BMD: '$',
    BND: '$',
    BOB: '$b',
    BOV: 'BOV',
    BRL: 'R$',
    BSD: '$',
    BTC: '₿',
    BTN: 'Nu.',
    BWP: 'P',
    BYN: 'Br',
    BYR: 'Br',
    BZD: 'BZ$',
    CAD: '$',
    CDF: 'FC',
    CHE: 'CHE',
    CHF: 'CHF',
    CHW: 'CHW',
    CLF: 'CLF',
    CLP: '$',
    CNH: '¥',
    CNY: '¥',
    COP: '$',
    COU: 'COU',
    CRC: '₡',
    CUC: '$',
    CUP: '₱',
    CVE: '$',
    CZK: 'Kč',
    DJF: 'Fdj',
    DKK: 'kr',
    DOP: 'RD$',
    DZD: 'دج',
    EEK: 'kr',
    EGP: '£',
    ERN: 'Nfk',
    ETB: 'Br',
    ETH: 'Ξ',
    EUR: '€',
    FJD: '$',
    FKP: '£',
    GBP: '£',
    GEL: '₾',
    GGP: '£',
    GHC: '₵',
    GHS: 'GH₵',
    GIP: '£',
    GMD: 'D',
    GNF: 'FG',
    GTQ: 'Q',
    GYD: '$',
    HKD: '$',
    HNL: 'L',
    HRK: 'kn',
    HTG: 'G',
    HUF: 'Ft',
    IDR: 'Rp',
    ILS: '₪',
    IMP: '£',
    INR: '₹',
    IQD: 'ع.د',
    IRR: '﷼',
    ISK: 'kr',
    JEP: '£',
    JMD: 'J$',
    JOD: 'JD',
    JPY: '¥',
    KES: 'KSh',
    KGS: 'лв',
    KHR: '៛',
    KMF: 'CF',
    KPW: '₩',
    KRW: '₩',
    KWD: 'KD',
    KYD: '$',
    KZT: '₸',
    LAK: '₭',
    LBP: '£',
    LKR: '₨',
    LRD: '$',
    LSL: 'M',
    LTC: 'Ł',
    LTL: 'Lt',
    LVL: 'Ls',
    LYD: 'LD',
    MAD: 'MAD',
    MDL: 'lei',
    MGA: 'Ar',
    MKD: 'ден',
    MMK: 'K',
    MNT: '₮',
    MOP: 'MOP$',
    MRO: 'UM',
    MRU: 'UM',
    MUR: '₨',
    MVR: 'Rf',
    MWK: 'MK',
    MXN: '$',
    MXV: 'MXV',
    MYR: 'RM',
    MZN: 'MT',
    NAD: '$',
    NGN: '₦',
    NIO: 'C$',
    NOK: 'kr',
    NPR: '₨',
    NZD: '$',
    OMR: '﷼',
    PAB: 'B/.',
    PEN: 'S/.',
    PGK: 'K',
    PHP: '₱',
    PKR: '₨',
    PLN: 'zł',
    PYG: 'Gs',
    QAR: '﷼',
    RMB: '￥',
    RON: 'lei',
    RSD: 'Дин.',
    RUB: '₽',
    RWF: 'R₣',
    SAR: '﷼',
    SBD: '$',
    SCR: '₨',
    SDG: 'ج.س.',
    SEK: 'kr',
    SGD: 'S$',
    SHP: '£',
    SLL: 'Le',
    SOS: 'S',
    SRD: '$',
    SSP: '£',
    STD: 'Db',
    STN: 'Db',
    SVC: '$',
    SYP: '£',
    SZL: 'E',
    THB: '฿',
    TJS: 'SM',
    TMT: 'T',
    TND: 'د.ت',
    TOP: 'T$',
    TRL: '₤',
    TRY: '₺',
    TTD: 'TT$',
    TVD: '$',
    TWD: 'NT$',
    TZS: 'TSh',
    UAH: '₴',
    UGX: 'USh',
    USD: '$',
    UYI: 'UYI',
    UYU: '$U',
    UYW: 'UYW',
    UZS: 'лв',
    VEF: 'Bs',
    VES: 'Bs.S',
    VND: '₫',
    VUV: 'VT',
    WST: 'WS$',
    XAF: 'FCFA',
    XBT: 'Ƀ',
    XCD: '$',
    XOF: 'CFA',
    XPF: '₣',
    XSU: 'Sucre',
    XUA: 'XUA',
    YER: '﷼',
    ZAR: 'R',
    ZMW: 'ZK',
    ZWD: 'Z$',
    ZWL: '$'
};

const install = {
    command: 'install',
    describe: 'Setup personal info for auto fill',
    handler: ()=>etask(function*(){
        let fk = new File_keyring();
        let billing = fk.get_billing();
        billing.signature = yield readline('Enter you signature (full '
            +'first/last name)', billing.signature, 'string');
        billing.contract_start = yield readline('Enter you contract start date',
            billing.contract_start, 'date');
        billing.country = yield readline('Enter you country',
            billing.country, 'string');
        billing.city = yield readline('Enter you city',
            billing.city, 'string');
        billing.zip = yield readline('Enter you zip code',
            billing.zip, 'string');
        billing.address = yield readline('Enter you address',
            billing.address, 'string');
        billing.bank_name = yield readline('Enter you full bank name.\n'
            +'Example - BANGKOK BANK PUBLIC COMPANY LIMITED',billing.bank_name,
            'string');
        billing.swift = yield readline('Enter you swift code.\n'
            +'Example - BKKBTHBK', billing.swift, 'string');
        billing.branch_name = yield readline('Enter you bank branch name if'
            +' any', billing.branch_name, 'nul_str');
        billing.branch_code = yield readline('Enter you bank branch code if'
            +' any', billing.branch_code, 'nul_str');
        billing.card_number = yield readline('Enter you card number',
            billing.card_number, 'string');

        let product = billing.products.find(x=>!x.fee);
        if (!product)
            billing.products.push(product = {fee: false});

        product.prod_name = yield readline('Enter what kind of service do you '
            +'provide.\nExample - Software engineering service',
            product.prod_name, 'string');
        product.price = yield readline('Enter $/hour', product.price,
            'positive');

        product = billing.products.find(x=>x.fee);
        if (!product && approval('Do you have additional monthly payment?'))
            billing.products.push(product = {fee: true});
        if (product)
        {
            product.fee = true;
            product.prod_name = 'A monthly fee';
            product.price = yield readline('Enter $/month', product.price,
                'positive');
        }
        billing.last_invoice_num = yield readline('Enter your last invoice '
            +'number', billing.last_invoice_num, 'positive_int');
        fk.save_billing(billing);
        console.log('DONE');
    }),
};
const today = {
    command: 'today',
    describe: `Print today's amount of earned money`,
    builder: yargs=>yargs
        .option('currency', {
            alias: 'c',
            array: true,
            type: 'string',
            default: ['eur', 'usd', 'ils', 'rub'],
            describe: 'Which currency we want to show',
        })
        .option('force', {
            alias: 'f',
            type: 'boolean',
            describe: 'Force updating currency exchange rate',
        }),
    handler: (argv)=>etask(function*(){
        keyring.init();
        let key_id = 'exchange.json';
        let exchange_raw = keyring.get(key_id);
        if (!exchange_raw || argv.force)
        {
            console.log('retreiving current exchange rate');
            let {body: {usd}} = yield wget('https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1/latest/currencies/usd.json',
                {json: 1});
            exchange_raw = JSON.stringify(usd);
            keyring.set(key_id, exchange_raw);
        }
        let map = new Map(Object.entries(JSON.parse(exchange_raw)));
        map.set('usd', 1);
        let curs = argv.currency.map(x=>x.toLowerCase()).filter(x=>map.has(x));
        if (!curs?.length)
        {
            return console.error('Select one from listed currencies:', curs);
        }
        curs = _.sortBy(curs, x=>map.get(x));

        let {body} = yield wget('http://web.brightdata.com/att/daily/status?login='+username);
        let {hours: {total}} = JSON.parse(body);
        let hours = date.str_to_dur(total) / date.ms.HOUR;
        let fk = new File_keyring();
        let data = fk.get_billing();
        let salary_per_hour = data?.products?.find(x=>!x.fee)?.price;
        if (!Number.isFinite(salary_per_hour))
        {
            return console.error('run "salary install" to customize your'+
                ' monthly salary');
        }
        let dollars = salary_per_hour * hours;
        console.log(`Work for ${total} today, $${salary_per_hour}/hour`);
        for (let currency_key of curs)
        {
            let modifier = map.get(currency_key);
            let sign = codes_upper_code[currency_key.toUpperCase()] || currency_key;
            console.log(`[${sign}] ${(modifier * dollars).toLocaleString('ru-RU', {maximumFractionDigits: 2})}`);
        }
    }),
};

yargs_root
    .command(bill)
    .command(install)
    .command(today)
    .completion('bash_completion', false)
    .help()
    .demandCommand()
    .recommendCommands()
    .wrap(yargs_root.terminalWidth())
    .argv;