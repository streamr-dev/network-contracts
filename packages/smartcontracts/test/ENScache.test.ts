import { waffle, upgrades, ethers } from 'hardhat'
import { expect, use } from 'chai'
import { utils, BigNumber } from 'ethers'

import ENSCacheJson from '../artifacts/contracts/chainlinkClient/ENSCache.sol/ENSCache.json'
import ForwarderJson from '../test-contracts/MinimalForwarder.json'
import OracleJson from '../test-contracts/Oracle.json'
import LinkTokenJson from '../test-contracts/LinkToken.json'
import type { ENSCache } from '../typechain/ENSCache'
import type { MinimalForwarder } from '../test-contracts/MinimalForwarder'
import type { Oracle } from '../test-contracts/Oracle'
import type { LinkToken } from '../test-contracts/LinkToken'
import type { StreamRegistry } from '../typechain/StreamRegistry'

const ethSigUtil = require('eth-sig-util')

const { deployContract } = waffle
const { provider } = waffle

use(waffle.solidity)

describe('ENSCache', (): void => {
    const wallets = provider.getWallets()
    let ensCacheFromAdmin: ENSCache
    let linkTokenFromAdmin: LinkToken
    let oracleFromAdmin: Oracle
    let minimalForwarderFromAdmin: MinimalForwarder
    let minimalForwarderFromUser0: MinimalForwarder
    let registryFromAdmin: StreamRegistry
    const adminAdress: string = wallets[0].address

    before(async (): Promise<void> => {
        minimalForwarderFromAdmin = await deployContract(wallets[0], ForwarderJson) as MinimalForwarder
        linkTokenFromAdmin = await deployContract(wallets[0], LinkTokenJson) as LinkToken
        oracleFromAdmin = await deployContract(wallets[0], OracleJson, [linkTokenFromAdmin.address]) as Oracle
        await oracleFromAdmin.setFulfillmentPermission(adminAdress, true)

        ensCacheFromAdmin = await deployContract(wallets[0], ENSCacheJson,
            // [adminAdress, 'jobid', minimalForwarderFromAdmin.address]) as ENSCache
            [adminAdress, 'jobid']) as ENSCache
        await ensCacheFromAdmin.setChainlinkTokenAddress(linkTokenFromAdmin.address)
        minimalForwarderFromUser0 = minimalForwarderFromAdmin.connect(wallets[1])

        await linkTokenFromAdmin.transfer(ensCacheFromAdmin.address,
            BigNumber.from('1000000000000000000000')) // 1000 link

        // registryFromAdmin = await deployContract(wallets[0], StreamRegistryJson,
        //     [ensCacheFromAdmin.address, minimalForwarderFromAdmin.address]) as StreamRegistry
        const streamRegistryFactory = await ethers.getContractFactory('StreamRegistry')
        const streamRegistryFactoryTx = await upgrades.deployProxy(streamRegistryFactory, [ensCacheFromAdmin.address, '0x7b5F1610920d5BAf00D684929272213BaF962eFe'], { kind: 'uups' })
        registryFromAdmin = await streamRegistryFactoryTx.deployed() as StreamRegistry
        await ensCacheFromAdmin.setStreamRegistry(registryFromAdmin.address)
    })

    it('positivetest queryENSOwner', async (): Promise<void> => {
        await expect(ensCacheFromAdmin.requestENSOwner('ensdomain1')).to.not.throw
    })

    it('create stream with ens sync trigger', async (): Promise<void> => {
        await expect(registryFromAdmin.createStreamWithENS('ensdomain1.eth', '/path', 'metadata')).to.not.throw
    })

    // it('positivetest istrustedForwarder', async (): Promise<void> => {
    //     expect(await ensCacheFromAdmin.isTrustedForwarder(minimalForwarderFromAdmin.address))
    //         .to.equal(true)
    // })

    it('positivetest metatransaction', async (): Promise<void> => {
        const data = await ensCacheFromAdmin.interface.encodeFunctionData('requestENSOwner', ['ensdomain1'])

        const req = {
            from: adminAdress,
            to: ensCacheFromAdmin.address,
            value: '0',
            gas: '100000',
            nonce: (await minimalForwarderFromAdmin.getNonce(adminAdress)).toString(),
            data
        }
        const sign = ethSigUtil.signTypedMessage(utils.arrayify(wallets[0].privateKey),
            {
                data: {
                    types: {
                        EIP712Domain: [
                            {
                                name: 'name', type: 'string'
                            },
                            {
                                name: 'version', type: 'string'
                            },
                            {
                                name: 'chainId', type: 'uint256'
                            },
                            {
                                name: 'verifyingContract', type: 'address'
                            },
                        ],
                        ForwardRequest: [
                            {
                                name: 'from', type: 'address'
                            },
                            {
                                name: 'to', type: 'address'
                            },
                            {
                                name: 'value', type: 'uint256'
                            },
                            {
                                name: 'gas', type: 'uint256'
                            },
                            {
                                name: 'nonce', type: 'uint256'
                            },
                            {
                                name: 'data', type: 'bytes'
                            },
                        ],
                    },
                    domain: {
                        name: 'MinimalForwarder',
                        version: '0.0.1',
                        chainId: (await provider.getNetwork()).chainId,
                        verifyingContract: minimalForwarderFromAdmin.address,
                    },
                    primaryType: 'ForwardRequest',
                    message: req
                }
            })

        const res = await minimalForwarderFromUser0.verify(req, sign)
        expect(res).to.be.true
        await expect(minimalForwarderFromUser0.execute(req, sign))
            .to.not.be.reverted
    })
})
