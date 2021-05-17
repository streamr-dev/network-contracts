import { waffle } from 'hardhat'
import { expect, use } from 'chai'

import StreamRegistryJson from '../artifacts/contracts/StreamRegistry/StreamRegistry.sol/StreamRegistry.json'
import { StreamRegistry } from '../typechain/StreamRegistry'

// import ENSCacheJson from '../artifacts/contracts/chainlinkClient/ENSCache.sol/ENSCache.json'
// import { ENSCache } from '../typechain/ENSCache'

const { deployContract } = waffle
const { provider } = waffle

// eslint-disable-next-line no-unused-vars
enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Share }

use(waffle.solidity)

describe('StreamRegistry', (): void => {
    const wallets = provider.getWallets()
    // let ensCacheFromAdmin: ENSCache
    let registryFromAdmin: StreamRegistry
    let registryFromUser0: StreamRegistry
    let registryFromUser1: StreamRegistry
    let registryFromMigrator: StreamRegistry
    // let registryFromUser1: StreamRegistry
    const adminAdress: string = wallets[0].address
    const user0Address: string = wallets[1].address
    const user1Address: string = wallets[2].address
    const migratorAddress: string = wallets[3].address
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
            [wallets[3].address, migratorAddress]) as StreamRegistry
        registryFromUser0 = registryFromAdmin.connect(wallets[1])
        registryFromUser1 = registryFromAdmin.connect(wallets[2])
        registryFromMigrator = registryFromAdmin.connect(wallets[3])
    })

    it('positivetest createStream + event, get description', async (): Promise<void> => {
        await expect(await registryFromAdmin.createStream(streamPath0, metadata0))
            .to.emit(registryFromAdmin, 'StreamCreated')
            .withArgs(streamId0, metadata0)
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, adminAdress, true, true, true, true, true)
        expect(await registryFromAdmin.streamIdToMetadata(streamId0)).to.equal(metadata0)
    })

    it('negativetest createStream, already exists error', async (): Promise<void> => {
        await expect(registryFromAdmin.createStream(streamPath0, metadata0))
            .to.be.revertedWith('stream id alreay exists')
    })

    // ENS tests seem to be impossible since enscache is dependent on chainlink
    // and chainlink contracts seem not to work with mock-chains
    // (chainlink docu says so, and trying to deploy LinkToken->Oracle->ENSCache does
    // work on Rinkeby, but does not on remix js-EVM or on Ganache)
    // write mock contracts?

    // it('positivetest createStream with ENS', async (): Promise<void> => {
    // })

    // it('negativetest createStream with ENS', async (): Promise<void> => {
    //     await expect(registryFromAdmin.createStreamWithENS('ensname.eth', streamPath0, metadata0))
    //         .to.be.revertedWith('you must be owner of the ensname')
    // })

    it('positivetest getStreamMetadata', async (): Promise<void> => {
        expect(await registryFromAdmin.getStreamMetadata(streamId0)).to.equal(metadata0)
    })

    it('negativetest getStreamMetadata, stream doesnt exist', async (): Promise<void> => {
        await expect(registryFromAdmin.getStreamMetadata(streamId1)).to.be.revertedWith('stream does not exist')
    })

    it('positivetest updateStreamMetadata + event', async (): Promise<void> => {
        expect(await registryFromAdmin.getStreamMetadata(streamId0)).to.equal(metadata0)
        await expect(await registryFromAdmin.updateStreamMetadata(streamId0, metadata1))
            .to.emit(registryFromAdmin, 'StreamUpdated')
            .withArgs(streamId0, metadata1)
        expect(await registryFromAdmin.getStreamMetadata(streamId0)).to.equal(metadata1)
    })

    it('negativetest updateStreamMetadata, not exist, no right', async (): Promise<void> => {
        await expect(registryFromAdmin.updateStreamMetadata(streamId1, metadata0))
            .to.be.revertedWith('stream does not exist')
        await expect(registryFromUser0.updateStreamMetadata(streamId0, metadata0))
            .to.be.revertedWith('no edit permission')
    })

    it('positivetest deleteStream + event', async (): Promise<void> => {
        expect(await registryFromAdmin.getStreamMetadata(streamId0)).to.equal(metadata1)
        await expect(await registryFromAdmin.deleteStream(streamId0))
            .to.emit(registryFromAdmin, 'StreamDeleted')
            .withArgs(streamId0)
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

    it('positivetest getDirectPermissionForUser', async (): Promise<void> => {
        expect(await registryFromAdmin.getDirectPermissionsForUser(streamId0, adminAdress))
            .to.deep.equal([true, true, true, true, true])
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
        await expect(await registryFromAdmin.setPermissionsForUser(streamId0, user0Address,
            true, true, true, true, true))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, true, true, true, true, true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, true, true, true])
        // test if he can edit streammetadata
        expect(await registryFromUser0.getStreamMetadata(streamId0)).to.equal(metadata0)
        await registryFromUser0.updateStreamMetadata(streamId0, metadata1)
        expect(await registryFromUser0.getStreamMetadata(streamId0)).to.equal(metadata1)
        // test if he can share, edit other permissions
        await expect(await registryFromUser0.setPermissionsForUser(streamId0, user1Address,
            true, true, true, true, true))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user1Address, true, true, true, true, true)
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
        await expect(await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Edit))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, true, false, false, false, false)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Edit))
            .to.equal(true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, false, false, false, false])

        await expect(await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Delete))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, true, true, false, false, false)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Delete))
            .to.equal(true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, false, false, false])

        await expect(await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Publish))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, true, true, true, false, false)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Publish))
            .to.equal(true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, true, false, false])

        await expect(await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, true, true, true, true, false)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.equal(true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, true, true, false])

        await expect(await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Share))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, true, true, true, true, true)
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
        await expect(await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Edit))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, false, true, true, true, true)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Edit))
            .to.equal(false)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, true, true, true, true])

        await expect(await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Delete))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, false, false, true, true, true)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Delete))
            .to.equal(false)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, true, true, true])

        await expect(await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Publish))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, false, false, false, true, true)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Publish))
            .to.equal(false)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, false, true, true])

        await expect(await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, false, false, false, false, true)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.equal(false)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, false, false, true])

        await expect(await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Share))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, false, false, false, false, false)
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

    it('positivetest revokeAllPermissionsForUser, hasPermission', async (): Promise<void> => {
        await registryFromAdmin.setPermissionsForUser(streamId0, user0Address, true, true, true, true, true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, true, true, true])
        await registryFromAdmin.revokeAllPermissionsForUser(streamId0, user0Address)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, false, false, false])
    })

    it('negativetest revokeAllPermissionsForUser', async (): Promise<void> => {
        await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Share)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Share))
            .to.equal(false)
        await expect(registryFromUser0.revokeAllPermissionsForUser(streamId0, user0Address))
            .to.be.revertedWith('no share permission')
    })

    // test if create stream->delete stream->recreate stream with same id also wipes
    // all permissions (not trivial since you can't delete mappings)
    it('recreate stream with same id wipes permissions', async (): Promise<void> => {
        await registryFromAdmin.deleteStream(streamId0)
        await registryFromAdmin.createStream(streamPath0, metadata0)
        // give user0 all permissions
        await registryFromAdmin.setPermissionsForUser(streamId0, user0Address, true, true, true, true, true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, true, true, true])
        // delete stream, and recreate with same id
        await registryFromAdmin.deleteStream(streamId0)
        await registryFromAdmin.createStream(streamPath0, metadata0)
        // check that user0 has no permission
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, false, false, false])
    })

    it('positivetest grantPublicPermission', async (): Promise<void> => {
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, false, false, false])
        await registryFromAdmin.grantPublicPermission(streamId0, PermissionType.Publish)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, true, false, false])
        await registryFromAdmin.grantPublicPermission(streamId0, PermissionType.Subscribe)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, true, true, false])
    })

    it('negativetest grantPublicPermission', async (): Promise<void> => {
        await expect(registryFromAdmin.grantPublicPermission(streamId0, PermissionType.Edit))
            .to.be.revertedWith('public: only subscribe,publish')
        await expect(registryFromAdmin.grantPublicPermission(streamId0, PermissionType.Delete))
            .to.be.revertedWith('public: only subscribe,publish')
        await expect(registryFromAdmin.grantPublicPermission(streamId0, PermissionType.Share))
            .to.be.revertedWith('public: only subscribe,publish')
    })

    it('positivetest revokePublicPermission', async (): Promise<void> => {
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, true, true, false])
        await registryFromAdmin.revokePublicPermission(streamId0, PermissionType.Publish)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, false, true, false])
        await registryFromAdmin.revokePublicPermission(streamId0, PermissionType.Subscribe)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, false, false, false])
    })

    it('negativetest revokePublicPermission', async (): Promise<void> => {
        await expect(registryFromAdmin.revokePublicPermission(streamId0, PermissionType.Edit))
            .to.be.revertedWith('public: only subscribe,publish')
        await expect(registryFromAdmin.revokePublicPermission(streamId0, PermissionType.Delete))
            .to.be.revertedWith('public: only subscribe,publish')
        await expect(registryFromAdmin.revokePublicPermission(streamId0, PermissionType.Share))
            .to.be.revertedWith('public: only subscribe,publish')
    })

    it('positivetest setPublicPermission', async (): Promise<void> => {
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, false, false, false])
        await registryFromAdmin.setPublicPermission(streamId0, true, true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, true, true, false])
        await registryFromAdmin.setPublicPermission(streamId0, false, false)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, false, false, false])
    })

    // negativetest setPublicPermission is trivial, was tested in setPermissionsForUser negativetest
    it('positivetest migratorSetStream', async (): Promise<void> => {
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, migratorAddress))
            .to.deep.equal([false, false, false, false, false])
        expect(await registryFromAdmin.getStreamMetadata(streamId0))
            .to.deep.equal(metadata0)
        await registryFromMigrator.migratorSetStream(streamId0, metadata1)
        expect(await registryFromAdmin.getStreamMetadata(streamId0))
            .to.deep.equal(metadata1)
    })
})
