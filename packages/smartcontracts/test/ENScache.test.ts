import { waffle } from 'hardhat'
import { expect, use } from 'chai'
import { utils, BigNumber } from 'ethers'

import ENSCacheJson from '../artifacts/contracts/chainlinkClient/ENSCache.sol/ENSCache.json'
import { ENSCache } from '../typechain/ENSCache'
import ForwarderJson from '../artifacts/zeppelin4/metatx/MinimalForwarder.sol/MinimalForwarder.json'
import { MinimalForwarder } from '../typechain/MinimalForwarder'

import OracleJson from './Oracle.json'
import LinkTokenJson from './LinkToken.json'

import type { Oracle } from './Oracle'
import type { LinkToken } from './LinkToken'

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
    const adminAdress: string = wallets[0].address

    before(async (): Promise<void> => {
        minimalForwarderFromAdmin = await deployContract(wallets[0], ForwarderJson) as MinimalForwarder
        linkTokenFromAdmin = await deployContract(wallets[0], LinkTokenJson) as LinkToken
        oracleFromAdmin = await deployContract(wallets[0], OracleJson, [linkTokenFromAdmin.address]) as Oracle
        await oracleFromAdmin.setFulfillmentPermission(adminAdress, true)

        ensCacheFromAdmin = await deployContract(wallets[0], ENSCacheJson,
            [adminAdress, 'jobid', minimalForwarderFromAdmin.address]) as ENSCache
        await ensCacheFromAdmin.setChainlinkTokenAddress(linkTokenFromAdmin.address)
        minimalForwarderFromUser0 = minimalForwarderFromAdmin.connect(wallets[1])

        await linkTokenFromAdmin.transfer(ensCacheFromAdmin.address,
            BigNumber.from('1000000000000000000000')) // 1000 link
    })

    it('positivetest queryENSOwner', async (): Promise<void> => {
        await ensCacheFromAdmin.requestENSOwner('ensdomain1')
    })

    it('positivetest istrustedForwarder', async (): Promise<void> => {
        expect(await ensCacheFromAdmin.isTrustedForwarder(minimalForwarderFromAdmin.address))
            .to.equal(true)
    })

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
