import { waffle, network, ethers } from 'hardhat'
import { expect, use } from 'chai'

import StreamRegistryJson from '../artifacts/contracts/StreamRegistry/StreamRegistry.sol/StreamRegistry.json'
import { StreamRegistry } from '../typechain/StreamRegistry'
// import ENSCacheJson from '../artifacts/contracts/chainlinkClient/ENSCache.sol/ENSCache.json'
// import { ENSCache } from '../typechain/ENSCache'

const { deployContract } = waffle
const { provider } = waffle

enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Share }

use(waffle.solidity)

describe('StreamRegistry', (): void => {
    const wallets = provider.getWallets()
    // let ensCacheFromAdmin: ENSCache
    let registryFromAdmin: StreamRegistry
    let registryFromUser0: StreamRegistry
    let registryFromUser1: StreamRegistry
    // let registryFromUser1: StreamRegistry
    const adminAdress: string = wallets[0].address
    const user0Address: string = wallets[1].address
    const user1Address: string = wallets[2].address
    const streamPath0: string = '/streamPath0'
    const streamPath1: string = '/streamPath1'
    const streamId0: string = adminAdress.toLowerCase() + streamPath0
    const streamId1: string = adminAdress.toLowerCase() + streamPath1
    const metadata0: string = 'streammetadata0'
    const metadata1: string = 'streammetadata1'

    before(async (): Promise<void> => {
        // ensCacheFromAdmin = await deployContract(wallets[0], ENSCacheJson,
        //     [user1Address, 'jobid']) as ENSCache
        registryFromAdmin = await deployContract(wallets[0], StreamRegistryJson,
            [wallets[3].address]) as StreamRegistry
        registryFromUser0 = registryFromAdmin.connect(wallets[1])
        registryFromUser1 = registryFromAdmin.connect(wallets[2])
    })

    it('positivetest createStream, get description', async (): Promise<void> => {
        await expect(await registryFromAdmin.createStream(streamPath0, metadata0))
            .to.emit(registryFromAdmin, 'StreamCreated')
            .withArgs(streamId0, metadata0)
        expect(await registryFromAdmin.streamIdToMetadata(streamId0)).to.equal(metadata0)
    })

    it('negativetest createStream, already exists error', async (): Promise<void> => {
        await expect(registryFromAdmin.createStream(streamPath0, metadata0))
            .to.be.revertedWith('stream id alreay exists')
    })

    // TEST IF CREATE; DELETE; CREATE SAME ID DELETES PERMISSIONS!!!

    it('positivetest getStreamMetadata', async (): Promise<void> => {
        expect(await registryFromAdmin.getStreamMetadata(streamId0)).to.equal(metadata0)
    })

    it('negativetest getStreamMetadata, stream doesnt exist', async (): Promise<void> => {
        await expect(registryFromAdmin.getStreamMetadata(streamId1)).to.be.revertedWith('stream does not exist')
    })

    it('positivetest updateStreamMetadata', async (): Promise<void> => {
        expect(await registryFromAdmin.getStreamMetadata(streamId0)).to.equal(metadata0)
        await registryFromAdmin.updateStreamMetadata(streamId0, metadata1)
        expect(await registryFromAdmin.getStreamMetadata(streamId0)).to.equal(metadata1)
    })

    it('negativetest updateStreamMetadata, not exist, no right', async (): Promise<void> => {
        await expect(registryFromAdmin.updateStreamMetadata(streamId1, metadata0))
            .to.be.revertedWith('stream does not exist')
        await expect(registryFromUser0.updateStreamMetadata(streamId0, metadata0))
            .to.be.revertedWith('no edit permission')
    })

    it('positivetest deleteStream', async (): Promise<void> => {
        expect(await registryFromAdmin.getStreamMetadata(streamId0)).to.equal(metadata1)
        await registryFromAdmin.deleteStream(streamId0)
        await expect(registryFromAdmin.updateStreamMetadata(streamId0, metadata0))
            .to.be.revertedWith('stream does not exist')
    })

    it('negativetest deleteStream, not exist, no right', async (): Promise<void> => {
        await registryFromAdmin.createStream(streamPath0, metadata0)
        await expect(registryFromAdmin.deleteStream(streamId1))
            .to.be.revertedWith('stream does not exist')
        await expect(registryFromUser0.deleteStream(streamId0))
            .to.be.revertedWith('no delete permission')
    })

    it('positivetest getPermissionForUser', async (): Promise<void> => {
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, adminAdress))
            .to.deep.equal([true, true, true, true, true])
    })

    it('negativtest getPermissionForUser, stream not exist, userentry not exist', async (): Promise<void> => {
        await expect(registryFromAdmin.getPermissionsForUser(streamId1, adminAdress))
            .to.be.revertedWith('stream does not exist')
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, false, false, false])
    })

    it('positivetest setPermissionForUser', async (): Promise<void> => {
        // user0 has no permissions on stream0
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, false, false, false])
        // grant him all permissions
        await registryFromAdmin.setPermissionsForUser(streamId0, user0Address, true, true, true, true, true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, true, true, true])
        // test if he can edit streammetadata
        expect(await registryFromUser0.getStreamMetadata(streamId0)).to.equal(metadata0)
        await registryFromUser0.updateStreamMetadata(streamId0, metadata1)
        expect(await registryFromUser0.getStreamMetadata(streamId0)).to.equal(metadata1)
        // test if he can share, edit other permissions
        await registryFromUser0.setPermissionsForUser(streamId0, user1Address, true, true, true, true, true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user1Address))
            .to.deep.equal([true, true, true, true, true])
        // test if he can delete stream
        await registryFromUser0.deleteStream(streamId0)
        await expect(registryFromAdmin.getStreamMetadata(streamId0))
            .to.be.revertedWith('stream does not exist')
    })

    it('negativtest setPermissionForUser, stream doesnt exist, no share permission', async (): Promise<void> => {
        await expect(registryFromAdmin.getPermissionsForUser(streamId0, adminAdress))
            .to.be.revertedWith('stream does not exist')
        await registryFromAdmin.createStream(streamPath0, metadata0)
        await expect(registryFromUser0.setPermissionsForUser(streamId0, user0Address, true, true, true, true, true))
            .to.be.revertedWith('no share permission')
    })

    it('positivetest grantPermission, hasPermission', async (): Promise<void> => {
        // user0 has no permissions on stream0
        await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Edit)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Edit))
            .to.equal(true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, false, false, false, false])

        await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Delete)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Delete))
            .to.equal(true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, false, false, false])

        await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Publish)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Publish))
            .to.equal(true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, true, false, false])

        await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Subscribe)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.equal(true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, true, true, false])

        await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Share)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Share))
            .to.equal(true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, true, true, true])
    })

    it('negativetest grantPermission', async (): Promise<void> => {
        // test from user1, who has no share permissions
        await expect(registryFromUser1.grantPermission(streamId0, user0Address, PermissionType.Edit))
            .to.be.revertedWith('no share permission')
        await expect(registryFromUser1.grantPermission(streamId0, user0Address, PermissionType.Delete))
            .to.be.revertedWith('no share permission')
        await expect(registryFromUser1.grantPermission(streamId0, user0Address, PermissionType.Publish))
            .to.be.revertedWith('no share permission')
        await expect(registryFromUser1.grantPermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.be.revertedWith('no share permission')
        await expect(registryFromUser1.grantPermission(streamId0, user0Address, PermissionType.Share))
            .to.be.revertedWith('no share permission')
    })

    it('positivetest revokePermission, hasPermission', async (): Promise<void> => {
        // user0 has no permissions on stream0
        await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Edit)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Edit))
            .to.equal(false)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, true, true, true, true])

        await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Delete)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Delete))
            .to.equal(false)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, true, true, true])

        await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Publish)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Publish))
            .to.equal(false)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, false, true, true])

        await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Subscribe)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.equal(false)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, false, false, true])

        await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Share)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Share))
            .to.equal(false)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, false, false, false])
    })

    it('negativetest grantPermission', async (): Promise<void> => {
        // test from user0, all his permissions were revoked in test before
        await expect(registryFromUser0.revokePermission(streamId0, user0Address, PermissionType.Edit))
            .to.be.revertedWith('no share permission')
        await expect(registryFromUser0.revokePermission(streamId0, user0Address, PermissionType.Delete))
            .to.be.revertedWith('no share permission')
        await expect(registryFromUser0.revokePermission(streamId0, user0Address, PermissionType.Publish))
            .to.be.revertedWith('no share permission')
        await expect(registryFromUser0.revokePermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.be.revertedWith('no share permission')
        await expect(registryFromUser0.revokePermission(streamId0, user0Address, PermissionType.Share))
            .to.be.revertedWith('no share permission')
    })
})
