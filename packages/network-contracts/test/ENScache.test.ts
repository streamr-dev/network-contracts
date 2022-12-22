import { upgrades, ethers } from 'hardhat'
import { expect } from 'chai'
import { utils, BigNumber } from 'ethers'

import ENSCacheJson from '../artifacts/contracts/chainlinkClient/ENSCache.sol/ENSCache.json'
import ForwarderJson from '../artifacts/@openzeppelin/contracts/metatx/MinimalForwarder.sol/MinimalForwarder.json'
import OracleJson from '../artifacts/@chainlink/contracts/src/v0.6/Oracle.sol/Oracle.json'
import LinkTokenJson from '../artifacts/@chainlink/contracts/src/v0.4/LinkToken.sol/LinkToken.json'
import type { ENSCache } from '../typechain/ENSCache'
import type { MinimalForwarder } from '../typechain/MinimalForwarder'
import type { Oracle } from '../typechain/Oracle'
import type { LinkToken } from '../typechain/LinkToken'
import type { StreamRegistry } from '../typechain/StreamRegistry'

describe('ENSCache', async (): Promise<void> => {
    let wallets
    let ensCacheFromAdmin: ENSCache
    let linkTokenFromAdmin: LinkToken
    let oracleFromAdmin: Oracle
    let minimalForwarderFromAdmin: MinimalForwarder
    // let minimalForwarderFromUser0: MinimalForwarder
    let registryFromAdmin: StreamRegistry
    let adminAdress: string

    before(async (): Promise<void> => {
        wallets = await ethers.getSigners()
        adminAdress = wallets[0].address
        // Deploy contracs
        const minimalForwarderFromAdminFactory = await ethers.getContractFactory(
            ForwarderJson.abi,
            ForwarderJson.bytecode,
            wallets[0]
        )
        minimalForwarderFromAdmin = (await minimalForwarderFromAdminFactory.deploy()) as MinimalForwarder
        await minimalForwarderFromAdmin.deployed()
        const linkTokenFromAdminFactory = await ethers.getContractFactory(
            LinkTokenJson.abi,
            LinkTokenJson.bytecode,
            wallets[0]
        )
        linkTokenFromAdmin = (await linkTokenFromAdminFactory.deploy()) as LinkToken
        await linkTokenFromAdmin.deployed()
        const oracleFromAdminFactory = await ethers.getContractFactory(
            OracleJson.abi,
            OracleJson.bytecode,
            wallets[0]
        )
        oracleFromAdmin = (await oracleFromAdminFactory.deploy(linkTokenFromAdmin.address)) as Oracle
        await oracleFromAdmin.deployed()
        await oracleFromAdmin.setFulfillmentPermission(adminAdress, true)
        const ensCacheFromAdminFactory = await ethers.getContractFactory(
            ENSCacheJson.abi,
            ENSCacheJson.bytecode,
            wallets[0]
        )
        ensCacheFromAdmin = (await ensCacheFromAdminFactory.deploy(adminAdress, 'jobid')) as ENSCache
        await ensCacheFromAdmin.deployed()

        await ensCacheFromAdmin.setChainlinkTokenAddress(linkTokenFromAdmin.address)

        await linkTokenFromAdmin.transfer(ensCacheFromAdmin.address,
            BigNumber.from('1000000000000000000000')) // 1000 link

        const streamRegistryFactory = await ethers.getContractFactory('StreamRegistryV2')
        const streamRegistryFactoryTx = await upgrades.deployProxy(streamRegistryFactory, [
            ensCacheFromAdmin.address,
            minimalForwarderFromAdmin.address
        ], { kind: 'uups' })
        registryFromAdmin = await streamRegistryFactoryTx.deployed() as StreamRegistry
        await registryFromAdmin.grantRole(await registryFromAdmin.TRUSTED_ROLE(), ensCacheFromAdmin.address)
        await ensCacheFromAdmin.setStreamRegistry(registryFromAdmin.address)
    })

    it('updates the cache entry: requestENSOwner', async () => {
        const tx = await ensCacheFromAdmin.requestENSOwner('ensdomain1')
        const tr = await tx.wait()
        const requestId = tr.logs[0].topics[1]
        await expect(ensCacheFromAdmin.fulfillENSOwner(requestId, utils.hexZeroPad(adminAdress, 32)))
            .to.emit(ensCacheFromAdmin, 'ChainlinkFulfilled')
            .and.to.not.emit(registryFromAdmin, 'StreamCreated')
    })

    it('updates the cache entry and creates a stream: requestENSOwnerAndCreateStream', async () => {
        const tx = await ensCacheFromAdmin.requestENSOwnerAndCreateStream('ensdomain1', '/path', 'metadata', adminAdress)
        const tr = await tx.wait()
        const requestId = tr.logs[0].topics[1]
        await expect(ensCacheFromAdmin.fulfillENSOwner(requestId, utils.hexZeroPad(adminAdress, 32))).to.emit(registryFromAdmin, 'StreamCreated')
    })

    // TODO: ENSCache is not meta-transaction ready right now

    // it('positivetest istrustedForwarder', async (): Promise<void> => {
    //     expect(await ensCacheFromAdmin.isTrustedForwarder(minimalForwarderFromAdmin.address)).to.equal(true)
    // })

    // it('positivetest metatransaction', async (): Promise<void> => {
    //     const data = await ensCacheFromAdmin.interface.encodeFunctionData('requestENSOwner', ['ensdomain1'])

    //     const req = {
    //         from: adminAdress,
    //         to: ensCacheFromAdmin.address,
    //         value: '0',
    //         gas: '100000',
    //         nonce: (await minimalForwarderFromAdmin.getNonce(adminAdress)).toString(),
    //         data
    //     }
    //     const sign = ethSigUtil.signTypedMessage(utils.arrayify(wallets[0].privateKey),
    //         {
    //             data: {
    //                 types: {
    //                     EIP712Domain: [
    //                         {
    //                             name: 'name', type: 'string'
    //                         },
    //                         {
    //                             name: 'version', type: 'string'
    //                         },
    //                         {
    //                             name: 'chainId', type: 'uint256'
    //                         },
    //                         {
    //                             name: 'verifyingContract', type: 'address'
    //                         },
    //                     ],
    //                     ForwardRequest: [
    //                         {
    //                             name: 'from', type: 'address'
    //                         },
    //                         {
    //                             name: 'to', type: 'address'
    //                         },
    //                         {
    //                             name: 'value', type: 'uint256'
    //                         },
    //                         {
    //                             name: 'gas', type: 'uint256'
    //                         },
    //                         {
    //                             name: 'nonce', type: 'uint256'
    //                         },
    //                         {
    //                             name: 'data', type: 'bytes'
    //                         },
    //                     ],
    //                 },
    //                 domain: {
    //                     name: 'MinimalForwarder',
    //                     version: '0.0.1',
    //                     chainId: (await provider.getNetwork()).chainId,
    //                     verifyingContract: minimalForwarderFromAdmin.address,
    //                 },
    //                 primaryType: 'ForwardRequest',
    //                 message: req
    //             }
    //         })

    //     const res = await minimalForwarderFromUser0.verify(req, sign)
    //     expect(res).to.be.true
    //     await expect(minimalForwarderFromUser0.execute(req, sign)).to.not.be.reverted
    // })
})
