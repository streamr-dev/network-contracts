const { Wallet } = require("ethers")
const fs = require('fs')
const outputfile = 'genesisAddresses.json'
const outputfileKeys = 'genesisKeys.txt'

for (i = 1; i <= 1000; i++) {
    const hexString = i.toString(16)
    privkey = '0x' + hexString.padStart(64, '0')
    const wallet = new Wallet(privkey)
    console.log(wallet.address)
    const content = `"${wallet.address}": {
        "balance": "1000000000000000000000000"
    },
    `
    fs.appendFileSync(outputfile, content, (err) => {
        if (err) {
            console.error(err)
            return
        }
    })
    fs.appendFileSync(outputfileKeys, privkey + ',\n', (err) => {
        if (err) {
            console.error(err)
            return
        }
    })
}

// "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c": {
//     "balance": "1000000000000000000000000"
//   },

// "0xa3d1F77ACfF0060F7213D7BF3c7fEC78df847De1": {
//     "balance": "1000000000000000000000000"
//   },

// const s = new Wallet('0x0000000000000000000000000000000000000000000000000000000000000000')

// 0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0
// 0x000000000000000000000000000000000000000000000000000000000000005f