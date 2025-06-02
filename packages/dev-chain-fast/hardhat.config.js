module.exports = {

    defaultNetwork: 'hardhat',
    networks: {
        hardhat: {
            initialDate: "2025-01-01T00:00:00Z", // deploy.ts will set block timestamp to wall clock time after it's done
            gas: 12000000,
            blockGasLimit: 0x1fffffffffffff,
            allowUnlimitedContractSize: true,
            mining: {
                // TODO: consider setting auto to false
                //   pro: in real setting, many tx can go into the same block, with automine every tx gets its own block
                //   pro: with auto:true, if tx are sent very fast, since each block must increment by at least 1 second
                //     it may cause block timestamps to drift forward from the wall clock time; auto:false would fix this
                //   con: tests will probably run slower
                auto: true,
                interval: 1000
            },
            accounts: [
                { "privateKey": "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0", "balance": "100000000000000000000000000" },
                { "privateKey": "0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb", "balance": "100000000000000000000000000" },
                { "privateKey": "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae", "balance": "100000000000000000000000000" },
                { "privateKey": "0x633a182fb8975f22aaad41e9008cb49a432e9fdfef37f151e9e7c54e96258ef9", "balance": "100000000000000000000000000" },
                { "privateKey": "0x957a8212980a9a39bf7c03dcbeea3c722d66f2b359c669feceb0e3ba8209a297", "balance": "100000000000000000000000000" },
                { "privateKey": "0xfe1d528b7e204a5bdfb7668a1ed3adfee45b4b96960a175c9ef0ad16dd58d728", "balance": "100000000000000000000000000" },
                { "privateKey": "0xd7609ae3a29375768fac8bc0f8c2f6ac81c5f2ffca2b981e6cf15460f01efe14", "balance": "100000000000000000000000000" },
                { "privateKey": "0xb1abdb742d3924a45b0a54f780f0f21b9d9283b231a0a0b35ce5e455fa5375e7", "balance": "100000000000000000000000000" },
                { "privateKey": "0x2cd9855d17e01ce041953829398af7e48b24ece04ff9d0e183414de54dc52285", "balance": "100000000000000000000000000" },
                { "privateKey": "0xaa7a3b3bb9b4a662e756e978ad8c6464412e7eef1b871f19e5120d4747bce966", "balance": "100000000000000000000000000" },
                { "privateKey": "0xa51ef2b7a1f160e53cc3a17c5a74ea0563a50030644e9f6e1b1f4a7d0afd088e", "balance": "100000000000000000000000000" },
                { "privateKey": "0x2ba0e218041e81b8e5c88ee4134995c1e358c2c01664676d975792057c57e333", "balance": "100000000000000000000000000" }
            ]
        },
    },
    solidity: {
        compilers: [
            {
                version: '0.8.13',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 100,
                    },
                },
            },
        ],
    }
}