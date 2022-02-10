import { waffle, upgrades, ethers } from 'hardhat'
import { expect, use } from 'chai'
import { BigNumber, utils, Wallet } from 'ethers'

// import StreamRegistryJson from '../artifacts/contracts/StreamRegistry/StreamRegistry.sol/StreamRegistry.json'
// import ENSMockJson from '../artifacts/contracts/StreamRegistry/StreamRegistry.sol/StreamRegistry.json'
// import { ENSMock } from '../typechain/StreamRegistry'
import ForwarderJson from '../test-contracts/MinimalForwarder.json'
import type { MinimalForwarder } from '../test-contracts/MinimalForwarder'
import type { StreamRegistry } from '../typechain/StreamRegistry'

const ethSigUtil = require('eth-sig-util')

const { deployContract } = waffle
const { provider } = waffle

const types = {
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
}

// eslint-disable-next-line no-unused-vars
enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Share }

const getBlocktime = async () : Promise<number> => {
    const blocknumber = await ethers.provider.getBlockNumber()
    const block = await ethers.provider.getBlock(blocknumber)
    return block.timestamp
}

use(waffle.solidity)
describe('StreamRegistry', (): void => {
    const wallets = provider.getWallets()
    // let ensCacheFromAdmin: ENSCache
    let registryFromAdmin: StreamRegistry
    let registryFromUser0: StreamRegistry
    let registryFromUser1: StreamRegistry
    let registryFromMigrator: StreamRegistry
    let minimalForwarderFromUser0: MinimalForwarder
    let MAX_INT: BigNumber
    let blocktime: number
    // let registryFromUser1: StreamRegistry
    const adminAdress: string = wallets[0].address
    const user0Address: string = wallets[1].address
    const user1Address: string = wallets[2].address
    const trustedAddress: string = wallets[3].address
    const streamPath0: string = '/streamPath0'
    const streamPath1: string = '/streamPath1'
    const streamPath2: string = '/streamPath2'
    const streamId0: string = adminAdress.toLowerCase() + streamPath0
    const streamId1: string = adminAdress.toLowerCase() + streamPath1
    const streamId2: string = adminAdress.toLowerCase() + streamPath2
    const metadata0: string = 'streammetadata0'
    const metadata1: string = 'streammetadata1'

    before(async (): Promise<void> => {
        minimalForwarderFromUser0 = await deployContract(wallets[1], ForwarderJson) as MinimalForwarder
        const streamRegistryFactory = await ethers.getContractFactory('StreamRegistryV3')
        const streamRegistryFactoryTx = await upgrades.deployProxy(streamRegistryFactory,
            ['0x0000000000000000000000000000000000000000', minimalForwarderFromUser0.address], {
                kind: 'uups'
            })
        registryFromAdmin = await streamRegistryFactoryTx.deployed() as StreamRegistry
        registryFromUser0 = registryFromAdmin.connect(wallets[1])
        registryFromUser1 = registryFromAdmin.connect(wallets[2])
        registryFromMigrator = registryFromAdmin.connect(wallets[3])
        MAX_INT = await registryFromAdmin.MAX_INT()
        await registryFromAdmin.grantRole(await registryFromAdmin.TRUSTED_ROLE(), trustedAddress)
    })

    it('positivetest createStream + event, get description', async (): Promise<void> => {
        await expect(await registryFromAdmin.createStream(streamPath0, metadata0))
            .to.emit(registryFromAdmin, 'StreamCreated')
            .withArgs(streamId0, metadata0)
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, adminAdress, true, true, MAX_INT, MAX_INT, true)
        expect(await registryFromAdmin.streamIdToMetadata(streamId0)).to.equal(metadata0)
    })

    it('positivetest createStream path character edgecases', async (): Promise<void> => {
        expect(await registryFromAdmin.createStream('/', metadata0))
            .to.not.throw
        expect(await registryFromAdmin.createStream('/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./_-', metadata0))
            .to.not.throw
    })

    it('negativetest createStream path character edgecases', async (): Promise<void> => {
        await expect(registryFromAdmin.createStream('/,', metadata0))
            .to.be.revertedWith('error_invalidPathChars')
        await expect(registryFromAdmin.createStream('/:', metadata0))
            .to.be.revertedWith('error_invalidPathChars')
        await expect(registryFromAdmin.createStream('/@', metadata0))
            .to.be.revertedWith('error_invalidPathChars')
        await expect(registryFromAdmin.createStream('/[', metadata0))
            .to.be.revertedWith('error_invalidPathChars')
        await expect(registryFromAdmin.createStream('/`', metadata0))
            .to.be.revertedWith('error_invalidPathChars')
        await expect(registryFromAdmin.createStream('/{', metadata0))
            .to.be.revertedWith('error_invalidPathChars')
    })

    it('negativetest createStream, already exists error', async (): Promise<void> => {
        await expect(registryFromAdmin.createStream(streamPath0, metadata0))
            .to.be.revertedWith('error_streamAlreadyExists')
    })

    it('negativetest createStream, path not starting with slash', async (): Promise<void> => {
        await expect(registryFromAdmin.createStream('pathWithoutSalsh', metadata0))
            .to.be.revertedWith('error_pathMustStartWithSlash')
    })

    it('positivetest getStreamMetadata', async (): Promise<void> => {
        expect(await registryFromAdmin.getStreamMetadata(streamId0)).to.equal(metadata0)
    })

    it('positivetest setEnsCache', async (): Promise<void> => {
        const role = await registryFromAdmin.TRUSTED_ROLE()
        const has = await registryFromAdmin.hasRole(role, trustedAddress)
        expect(has).to.equal(true)
        await registryFromMigrator.setEnsCache('0x0000000000000000000000000000000000000000')
    })

    it('negativetest getStreamMetadata, stream doesnt exist', async (): Promise<void> => {
        await expect(registryFromAdmin.getStreamMetadata(streamId1)).to.be.revertedWith('error_streamDoesNotExist')
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
            .to.be.revertedWith('error_streamDoesNotExist')
        await expect(registryFromUser0.updateStreamMetadata(streamId0, metadata0))
            .to.be.revertedWith('error_noEditPermission')
    })

    it('positivetest deleteStream + event', async (): Promise<void> => {
        expect(await registryFromAdmin.getStreamMetadata(streamId0)).to.equal(metadata1)
        await expect(await registryFromAdmin.deleteStream(streamId0))
            .to.emit(registryFromAdmin, 'StreamDeleted')
            .withArgs(streamId0)
        await expect(registryFromAdmin.updateStreamMetadata(streamId0, metadata0))
            .to.be.revertedWith('error_streamDoesNotExist')
    })

    it('negativetest deleteStream, not exist, no right', async (): Promise<void> => {
        await registryFromAdmin.createStream(streamPath0, metadata0)
        await expect(registryFromAdmin.deleteStream(streamId1))
            .to.be.revertedWith('error_streamDoesNotExist')
        await expect(registryFromUser0.deleteStream(streamId0))
            .to.be.revertedWith('error_noDeletePermission')
    })

    it('positivetest getDirectPermissionForUser', async (): Promise<void> => {
        expect(await registryFromAdmin.getDirectPermissionsForUser(streamId0, adminAdress))
            .to.deep.equal([true, true, MAX_INT, MAX_INT, true])
    })

    it('positivetest getPermissionForUser', async (): Promise<void> => {
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, adminAdress))
            .to.deep.equal([true, true, MAX_INT, MAX_INT, true])
    })

    it('negativetest getPermissionForUser, stream not exist, userentry not exist', async (): Promise<void> => {
        await expect(registryFromAdmin.getPermissionsForUser(streamId1, adminAdress))
            .to.be.revertedWith('error_streamDoesNotExist')
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
    })

    it('positivetest setPermissionForUser', async (): Promise<void> => {
        // user0 has no permissions on stream0
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
        // grant him all permissions
        blocktime = await getBlocktime() + 1
        await expect(await registryFromAdmin.setPermissionsForUser(streamId0, user0Address,
            true, true, blocktime, blocktime, true))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true])
        // test if he can edit streammetadata
        expect(await registryFromUser0.getStreamMetadata(streamId0)).to.equal(metadata0)
        await registryFromUser0.updateStreamMetadata(streamId0, metadata1)
        expect(await registryFromUser0.getStreamMetadata(streamId0)).to.equal(metadata1)
        blocktime += 1
        // test if he can share, edit other permissions
        await expect(await registryFromUser0.setPermissionsForUser(streamId0, user1Address,
            true, true, blocktime, blocktime, true))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user1Address, true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user1Address))
            .to.deep.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true])
        // test if he can delete stream
        await registryFromUser0.deleteStream(streamId0)
        await expect(registryFromAdmin.getStreamMetadata(streamId0))
            .to.be.revertedWith('error_streamDoesNotExist')
    })

    it('negativetest setPermissionForUser, stream doesnt exist, error_noSharePermission', async (): Promise<void> => {
        await expect(registryFromAdmin.getPermissionsForUser(streamId0, adminAdress))
            .to.be.revertedWith('error_streamDoesNotExist')
        await registryFromAdmin.createStream(streamPath0, metadata0)
        await expect(registryFromUser0.setPermissionsForUser(streamId0, user0Address, true, true, 0, 0, true))
            .to.be.revertedWith('error_noSharePermission')
    })

    it('positivetest grantPermission, hasPermission', async (): Promise<void> => {
        // user0 has no permissions on stream0
        await expect(await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Edit))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, true, false, BigNumber.from(0), BigNumber.from(0), false)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Edit))
            .to.equal(true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, false, BigNumber.from(0), BigNumber.from(0), false])

        await expect(await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Delete))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, true, true, BigNumber.from(0), BigNumber.from(0), false)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Delete))
            .to.equal(true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, BigNumber.from(0), BigNumber.from(0), false])

        await expect(await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Publish))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, true, true, BigNumber.from(MAX_INT), BigNumber.from(0), false)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Publish))
            .to.equal(true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(0), false])

        await expect(await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.equal(true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false])

        await expect(await registryFromAdmin.grantPermission(streamId0, user0Address, PermissionType.Share))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Share))
            .to.equal(true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true])
    })

    it('negativetest grantPermission', async (): Promise<void> => {
        // test from user1, who has no share permissions
        await expect(registryFromUser1.grantPermission(streamId0, user0Address, PermissionType.Edit))
            .to.be.revertedWith('error_noSharePermission')
        await expect(registryFromUser1.grantPermission(streamId0, user0Address, PermissionType.Delete))
            .to.be.revertedWith('error_noSharePermission')
        await expect(registryFromUser1.grantPermission(streamId0, user0Address, PermissionType.Publish))
            .to.be.revertedWith('error_noSharePermission')
        await expect(registryFromUser1.grantPermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.be.revertedWith('error_noSharePermission')
        await expect(registryFromUser1.grantPermission(streamId0, user0Address, PermissionType.Share))
            .to.be.revertedWith('error_noSharePermission')
    })

    it('positivetest revokePermission, hasPermission', async (): Promise<void> => {
        // user0 has no permissions on stream0
        await expect(await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Edit))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, false, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Edit))
            .to.equal(false)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true])

        await expect(await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Delete))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, false, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Delete))
            .to.equal(false)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true])

        await expect(await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Publish))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, false, false, BigNumber.from(0), BigNumber.from(MAX_INT), true)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Publish))
            .to.equal(false)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(MAX_INT), true])

        await expect(await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, false, false, BigNumber.from(0), BigNumber.from(0), true)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Subscribe))
            .to.equal(false)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), true])

        await expect(await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Share))
            .to.emit(registryFromAdmin, 'PermissionUpdated')
            .withArgs(streamId0, user0Address, false, false, BigNumber.from(0), BigNumber.from(0), false)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Share))
            .to.equal(false)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
    })

    it('negativetest grantPermission', async (): Promise<void> => {
        // test from user0, all his permissions were revoked in test before
        await expect(registryFromUser0.revokePermission(streamId0, user1Address, PermissionType.Edit))
            .to.be.revertedWith('error_noSharePermission')
        await expect(registryFromUser0.revokePermission(streamId0, user1Address, PermissionType.Delete))
            .to.be.revertedWith('error_noSharePermission')
        await expect(registryFromUser0.revokePermission(streamId0, user1Address, PermissionType.Publish))
            .to.be.revertedWith('error_noSharePermission')
        await expect(registryFromUser0.revokePermission(streamId0, user1Address, PermissionType.Subscribe))
            .to.be.revertedWith('error_noSharePermission')
        await expect(registryFromUser0.revokePermission(streamId0, user1Address, PermissionType.Share))
            .to.be.revertedWith('error_noSharePermission')
    })

    it('positivetest revokeAllPermissionsForUser, hasPermission', async (): Promise<void> => {
        blocktime = await getBlocktime()
        await registryFromAdmin.setPermissionsForUser(streamId0, user0Address, true, true, blocktime, blocktime, true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true])
        await registryFromAdmin.revokeAllPermissionsForUser(streamId0, user0Address)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
    })

    it('negativetest revokeAllPermissionsForUser', async (): Promise<void> => {
        await registryFromAdmin.revokePermission(streamId0, user0Address, PermissionType.Share)
        expect(await registryFromAdmin.hasPermission(streamId0, user0Address, PermissionType.Share))
            .to.equal(false)
        await expect(registryFromUser0.revokeAllPermissionsForUser(streamId0, user1Address))
            .to.be.revertedWith('error_noSharePermission')
    })

    // test if create stream->delete stream->recreate stream with same id also wipes
    // all permissions (not trivial since you can't delete mappings)
    it('recreate stream with same id wipes permissions', async (): Promise<void> => {
        await registryFromAdmin.deleteStream(streamId0)
        await registryFromAdmin.createStream(streamPath0, metadata0)
        // give user0 all permissions
        await registryFromAdmin.setPermissionsForUser(streamId0, user0Address,
            true, true, MAX_INT, MAX_INT, true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true])
        // delete stream, and recreate with same id
        await registryFromAdmin.deleteStream(streamId0)
        await registryFromAdmin.createStream(streamPath0, metadata0)
        // check that user0 has no permission
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
    })

    it('positivetest grantPublicPermission', async (): Promise<void> => {
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
        await registryFromAdmin.grantPublicPermission(streamId0, PermissionType.Publish)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(MAX_INT), BigNumber.from(0), false])
        await registryFromAdmin.grantPublicPermission(streamId0, PermissionType.Subscribe)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false])
        expect(await registryFromAdmin.hasPublicPermission(streamId0, PermissionType.Publish)).to.equal(true)
        expect(await registryFromAdmin.hasPublicPermission(streamId0, PermissionType.Subscribe)).to.equal(true)
        expect(await registryFromAdmin.hasPublicPermission(streamId0, PermissionType.Edit)).to.equal(false)
        expect(await registryFromAdmin.hasPublicPermission(streamId0, PermissionType.Delete)).to.equal(false)
        expect(await registryFromAdmin.hasPublicPermission(streamId0, PermissionType.Share)).to.equal(false)
    })

    it('negativetest grantPublicPermission', async (): Promise<void> => {
        await expect(registryFromAdmin.grantPublicPermission(streamId0, PermissionType.Edit))
            .to.be.revertedWith('error_publicCanOnlySubsPubl')
        await expect(registryFromAdmin.grantPublicPermission(streamId0, PermissionType.Delete))
            .to.be.revertedWith('error_publicCanOnlySubsPubl')
        await expect(registryFromAdmin.grantPublicPermission(streamId0, PermissionType.Share))
            .to.be.revertedWith('error_publicCanOnlySubsPubl')
    })

    it('positivetest revokePublicPermission', async (): Promise<void> => {
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false])
        await registryFromAdmin.revokePublicPermission(streamId0, PermissionType.Publish)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(MAX_INT), false])
        await registryFromAdmin.revokePublicPermission(streamId0, PermissionType.Subscribe)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
    })

    it('negativetest revokePublicPermission', async (): Promise<void> => {
        await expect(registryFromAdmin.revokePublicPermission(streamId0, PermissionType.Edit))
            .to.be.revertedWith('error_publicCanOnlySubsPubl')
        await expect(registryFromAdmin.revokePublicPermission(streamId0, PermissionType.Delete))
            .to.be.revertedWith('error_publicCanOnlySubsPubl')
        await expect(registryFromAdmin.revokePublicPermission(streamId0, PermissionType.Share))
            .to.be.revertedWith('error_publicCanOnlySubsPubl')
    })

    it('positivetest setPublicPermission', async (): Promise<void> => {
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
        await registryFromAdmin.setPublicPermission(streamId0, MAX_INT, MAX_INT)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false])
        blocktime = await getBlocktime() + 1
        await registryFromAdmin.setPublicPermission(streamId0, blocktime, blocktime)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(blocktime), BigNumber.from(blocktime), false])
        await registryFromAdmin.setPublicPermission(streamId0, 0, 0)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
    })

    it('positivetest setPermissions', async (): Promise<void> => {
        const userA = ethers.Wallet.createRandom().address
        const userB = ethers.Wallet.createRandom().address
        const permissionA = {
            canEdit: true,
            canDelete: false,
            publishExpiration: MAX_INT,
            subscribeExpiration: MAX_INT,
            canGrant: false
        }
        const permissionB = {
            canEdit: false,
            canDelete: true,
            publishExpiration: 1,
            subscribeExpiration: 1,
            canGrant: true
        }

        await registryFromAdmin.setPermissions(streamId0, [userA, userB], [permissionA, permissionB])
        expect(await registryFromAdmin.getDirectPermissionsForUser(streamId0, userA)).to.deep.equal(
            [true, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false]
        )
        expect(await registryFromAdmin.getDirectPermissionsForUser(streamId0, userB)).to.deep.equal(
            [false, true, BigNumber.from(1), BigNumber.from(1), true]
        )
    })

    it('positivetest setPermissionsMultipleStreams', async (): Promise<void> => {
        const userA = ethers.Wallet.createRandom().address
        const userB = ethers.Wallet.createRandom().address
        await registryFromAdmin.createStream(streamPath2, metadata1)
        expect(await registryFromAdmin.getStreamMetadata(streamId2)).to.equal(metadata1)
        const permissionA = {
            canEdit: true,
            canDelete: false,
            publishExpiration: MAX_INT,
            subscribeExpiration: MAX_INT,
            canGrant: false
        }
        const permissionB = {
            canEdit: false,
            canDelete: true,
            publishExpiration: 1,
            subscribeExpiration: 1,
            canGrant: true
        }

        await registryFromAdmin.setPermissionsMultipleStreans([streamId0, streamId2],
            [[userA, userB], [userA, userB]], [[permissionA, permissionB], [permissionA, permissionB]])
        expect(await registryFromAdmin.getDirectPermissionsForUser(streamId0, userA)).to.deep.equal(
            [true, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false]
        )
        expect(await registryFromAdmin.getDirectPermissionsForUser(streamId0, userB)).to.deep.equal(
            [false, true, BigNumber.from(1), BigNumber.from(1), true]
        )
        expect(await registryFromAdmin.getDirectPermissionsForUser(streamId2, userA)).to.deep.equal(
            [true, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false]
        )
        expect(await registryFromAdmin.getDirectPermissionsForUser(streamId2, userB)).to.deep.equal(
            [false, true, BigNumber.from(1), BigNumber.from(1), true]
        )
    })

    // negativetest setPublicPermission is trivial, was tested in setPermissionsForUser negativetest
    it('positivetest trustedRoleSetStream', async (): Promise<void> => {
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, trustedAddress))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
        expect(await registryFromAdmin.getStreamMetadata(streamId0))
            .to.deep.equal(metadata0)
        await registryFromMigrator.trustedSetStreamMetadata(streamId0, metadata1)
        expect(await registryFromAdmin.getStreamMetadata(streamId0))
            .to.deep.equal(metadata1)
    })

    it('positivetest getTrustedRoleId', async (): Promise<void> => {
        expect(await registryFromAdmin.getTrustedRole()).to.equal('0x2de84d9fbdf6d06e2cc584295043dbd76046423b9f8bae9426d4fa5e7c03f4a7')
    })

    it('positivetest trustedRoleSetPermissionsForUser', async (): Promise<void> => {
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, trustedAddress))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
        await registryFromMigrator.trustedSetPermissionsForUser(streamId0, user0Address,
            true, true, MAX_INT, MAX_INT, true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true])
    })

    it('negativetest trustedSetStream', async (): Promise<void> => {
        await expect(registryFromAdmin.trustedSetStreamMetadata(streamId0, metadata1))
            .to.be.revertedWith('error_mustBeTrustedRole')
    })

    it('positivetest trustedSetStreamWithPermissions', async (): Promise<void> => {
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true])
        expect(await registryFromAdmin.getStreamMetadata(streamId0))
            .to.deep.equal(metadata1)
        await registryFromMigrator.trustedSetStreamWithPermission(streamId0, metadata0, user0Address, false, false, 0, 0, false)
        expect(await registryFromAdmin.getStreamMetadata(streamId0))
            .to.deep.equal(metadata0)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
        await registryFromMigrator.trustedSetStreamWithPermission(streamId0, metadata1, user0Address, true, true, MAX_INT, MAX_INT, true)
        expect(await registryFromAdmin.getStreamMetadata(streamId0))
            .to.deep.equal(metadata1)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true])
    })

    it('negativetest trustedSetPermissionsForUser', async (): Promise<void> => {
        await expect(registryFromAdmin.trustedSetPermissionsForUser(streamId0,
            user0Address, true, true, MAX_INT, MAX_INT, true))
            .to.be.revertedWith('error_mustBeTrustedRole')
    })

    it('positivetest transferAllPermissionsToUser', async (): Promise<void> => {
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, adminAdress))
            .to.deep.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true])
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user1Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
        await registryFromAdmin.transferAllPermissionsToUser(streamId0, user1Address)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, adminAdress))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user1Address))
            .to.deep.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true])
            // make sure positive ones are not overwritten
            // user 0 and 1 both have all perms
        await registryFromUser0.setPermissionsForUser(streamId0, user0Address,
            true, false, 0, 0, false)
        // it also tests that user0 can transfer away even though he does not have share permission
        await registryFromUser0.transferAllPermissionsToUser(streamId0, user1Address)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user1Address))
            .to.deep.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true])
    })

    it('negativetest transferAllPermissionsToUser', async (): Promise<void> => {
        await expect(registryFromUser0.transferAllPermissionsToUser(streamId0, user1Address))
            .to.be.revertedWith('error_noPermissionToTransfer')
    })

    it('positivetest transferPermissionToUser', async (): Promise<void> => {
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user1Address))
            .to.deep.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true])
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
        await registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Edit)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user1Address))
            .to.deep.equal([false, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true])
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, false, BigNumber.from(0), BigNumber.from(0), false])
        await registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Delete)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user1Address))
            .to.deep.equal([false, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true])
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, BigNumber.from(0), BigNumber.from(0), false])
        await registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Publish)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user1Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(MAX_INT), true])
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(0), false])
        await registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Subscribe)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user1Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), true])
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false])
        await registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Share)
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user1Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
        expect(await registryFromAdmin.getPermissionsForUser(streamId0, user0Address))
            .to.deep.equal([true, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), true])
    })

    it('negativetest transferPermissionToUser', async (): Promise<void> => {
        await expect(registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Edit))
            .to.be.revertedWith('error_noPermissionToTransfer')
        await expect(registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Delete))
            .to.be.revertedWith('error_noPermissionToTransfer')
        await expect(registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Publish))
            .to.be.revertedWith('error_noPermissionToTransfer')
        await expect(registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Subscribe))
            .to.be.revertedWith('error_noPermissionToTransfer')
        await expect(registryFromUser1.transferPermissionToUser(streamId0, user0Address, PermissionType.Share))
            .to.be.revertedWith('error_noPermissionToTransfer')
    })

    it('positivetest istrustedForwarder', async (): Promise<void> => {
        expect(await registryFromAdmin.isTrustedForwarder(minimalForwarderFromUser0.address))
            .to.equal(true)
    })

    it('positivetest metatransaction', async (): Promise<void> => {
        // admin is creating and signing transaction, user0 is posting it and paying for gas
        const path = '/path'
        const metadata = 'metadata'
        const data = await registryFromAdmin.interface.encodeFunctionData('createStream', [path, metadata])
        const req = {
            from: adminAdress,
            to: registryFromAdmin.address,
            value: '0',
            gas: '1000000',
            nonce: (await minimalForwarderFromUser0.getNonce(adminAdress)).toString(),
            data
        }
        const sign = ethSigUtil.signTypedMessage(utils.arrayify(wallets[0].privateKey), // user0
            {
                data: {
                    types,
                    domain: {
                        name: 'MinimalForwarder',
                        version: '0.0.1',
                        chainId: (await provider.getNetwork()).chainId,
                        verifyingContract: minimalForwarderFromUser0.address,
                    },
                    primaryType: 'ForwardRequest',
                    message: req
                }
            })

        const res = await minimalForwarderFromUser0.verify(req, sign)
        await expect(res).to.be.true
        const tx = await minimalForwarderFromUser0.execute(req, sign)
        const tx2 = await tx.wait()
        expect(tx2.logs.length).to.equal(2)
        const id = adminAdress.toLowerCase() + path
        expect(await registryFromAdmin.getStreamMetadata(id)).to.equal(metadata)
    })

    it('negativetest metatransaction', async (): Promise<void> => {
        const path = '/path1'
        const metadata = 'metadata1'
        const data = await registryFromAdmin.interface.encodeFunctionData('createStream', [path, metadata])
        const req = {
            from: adminAdress,
            to: registryFromAdmin.address,
            value: '0',
            gas: '1000000',
            nonce: (await minimalForwarderFromUser0.getNonce(adminAdress)).toString(),
            data
        }
        // signing with user1 (walletindex 2)
        const sign = ethSigUtil.signTypedMessage(utils.arrayify(wallets[2].privateKey), // user0
            {
                data: {
                    types,
                    domain: {
                        name: 'MinimalForwarder',
                        version: '0.0.1',
                        chainId: (await provider.getNetwork()).chainId,
                        verifyingContract: minimalForwarderFromUser0.address,
                    },
                    primaryType: 'ForwardRequest',
                    message: req
                }
            })

        const res = await minimalForwarderFromUser0.verify(req, sign)
        await expect(res).to.be.false
        await expect(minimalForwarderFromUser0.execute(req, sign))
            .to.be.revertedWith('MinimalForwarder: signature does not match request')
    })

    it('negativetest metatransaction not enough gas in internal transaction call', async (): Promise<void> => {
        const path = '/path2'
        const metadata = 'metadata2'
        const data = await registryFromAdmin.interface.encodeFunctionData('createStream', [path, metadata])
        const req = {
            from: adminAdress,
            to: registryFromAdmin.address,
            value: '0',
            gas: '1000',
            nonce: (await minimalForwarderFromUser0.getNonce(adminAdress)).toString(),
            data
        }
        // signing with user1 (walletindex 2)
        const sign = ethSigUtil.signTypedMessage(utils.arrayify(wallets[0].privateKey), // user0
            {
                data: {
                    types,
                    domain: {
                        name: 'MinimalForwarder',
                        version: '0.0.1',
                        chainId: (await provider.getNetwork()).chainId,
                        verifyingContract: minimalForwarderFromUser0.address,
                    },
                    primaryType: 'ForwardRequest',
                    message: req
                }
            })

        const res = await minimalForwarderFromUser0.verify(req, sign)
        await expect(res).to.be.true
        const tx = await minimalForwarderFromUser0.execute(req, sign)
        const tx2 = await tx.wait()
        expect(tx2.logs.length).to.equal(0)
        const id = adminAdress.toLowerCase() + path
        await expect(registryFromAdmin.getStreamMetadata(id))
            .to.be.revertedWith('error_streamDoesNotExist')
    })

    it('positivetest revoke own permissions without share', async (): Promise<void> => {
        await registryFromAdmin.createStream(streamPath1, metadata1)
        expect(await registryFromAdmin.getStreamMetadata(streamId1)).to.equal(metadata1)

        await registryFromAdmin.setPermissionsForUser(streamId1, user0Address, true, true,
            MAX_INT, MAX_INT, false)
        await registryFromUser0.revokePermission(streamId1, user0Address, PermissionType.Edit)
        expect(await registryFromAdmin.getPermissionsForUser(streamId1, user0Address))
            .to.deep.equal([false, true, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false])
        await registryFromUser0.revokePermission(streamId1, user0Address, PermissionType.Delete)
        expect(await registryFromAdmin.getPermissionsForUser(streamId1, user0Address))
            .to.deep.equal([false, false, BigNumber.from(MAX_INT), BigNumber.from(MAX_INT), false])
        await registryFromUser0.revokePermission(streamId1, user0Address, PermissionType.Publish)
        expect(await registryFromAdmin.getPermissionsForUser(streamId1, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(MAX_INT), false])
        await registryFromUser0.revokePermission(streamId1, user0Address, PermissionType.Subscribe)
        expect(await registryFromAdmin.getPermissionsForUser(streamId1, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
    })

    it('negativetest revokeAllPermissionsForUser', async (): Promise<void> => {
        await registryFromAdmin.setPermissionsForUser(streamId1, user0Address,
            true, true, MAX_INT, MAX_INT, false)
        await registryFromUser0.revokeAllPermissionsForUser(streamId1, user0Address)
        expect(await registryFromAdmin.getPermissionsForUser(streamId1, user0Address))
            .to.deep.equal([false, false, BigNumber.from(0), BigNumber.from(0), false])
    })

    it('positivetest grantRole, revokerole', async (): Promise<void> => {
        await registryFromAdmin.grantRole(await registryFromAdmin.TRUSTED_ROLE(), adminAdress)
        expect(await registryFromAdmin.hasRole(await registryFromAdmin.TRUSTED_ROLE(), adminAdress))
            .to.equal(true)
        await registryFromAdmin.revokeRole(await registryFromAdmin.TRUSTED_ROLE(), adminAdress)
        expect(await registryFromAdmin.hasRole(await registryFromAdmin.TRUSTED_ROLE(), adminAdress))
            .to.equal(false)
    })

    it('negativetest grantRole, revokerole', async (): Promise<void> => {
        await expect(registryFromUser0.grantRole(await registryFromAdmin.TRUSTED_ROLE(), user0Address))
            .to.be.revertedWith('account 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 is missing '
            + 'role 0x0000000000000000000000000000000000000000000000000000000000000000')
    })

    it('positivetest setExpirationTime', async (): Promise<void> => {
        await registryFromAdmin.setPermissionsForUser(streamId1, user0Address,
            true, true, MAX_INT, MAX_INT, true)
        await registryFromAdmin.setExpirationTime(streamId1, user0Address, PermissionType.Publish, 7)
        expect(await registryFromAdmin.getPermissionsForUser(streamId1, user0Address))
            .to.deep.equal([true, true, BigNumber.from(7), BigNumber.from(MAX_INT), true])
        await registryFromAdmin.setExpirationTime(streamId1, user0Address, PermissionType.Subscribe, 7)
        expect(await registryFromAdmin.getPermissionsForUser(streamId1, user0Address))
            .to.deep.equal([true, true, BigNumber.from(7), BigNumber.from(7), true])
    })

    it('negativetest setExpirationTime', async (): Promise<void> => {
        await expect(registryFromAdmin.setExpirationTime(streamId1, user0Address, PermissionType.Edit, 7))
            .to.be.revertedWith('error_timeOnlyObPubSub')
        await expect(registryFromAdmin.setExpirationTime(streamId1, user0Address, PermissionType.Delete, 7))
            .to.be.revertedWith('error_timeOnlyObPubSub')
        await expect(registryFromAdmin.setExpirationTime(streamId1, user0Address, PermissionType.Share, 7))
            .to.be.revertedWith('error_timeOnlyObPubSub')
    })

    it('edgecases expirationtime', async (): Promise<void> => {
        blocktime = await getBlocktime() + 1
        await registryFromAdmin.setPermissionsForUser(streamId1, user0Address, true, true, blocktime, blocktime, true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId1, user0Address))
            .to.deep.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true])
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(true)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(true)
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(true)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(true)
        // setting it again will advance the blocktime and expire the rights
        await registryFromAdmin.setPermissionsForUser(streamId1, user0Address, true, true, blocktime, blocktime, true)
        expect(await registryFromAdmin.getPermissionsForUser(streamId1, user0Address))
            .to.deep.equal([true, true, BigNumber.from(blocktime), BigNumber.from(blocktime), true])
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(false)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(false)
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(false)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(false)
        // give public publish permission, check again
        await registryFromAdmin.setPublicPermission(streamId1, blocktime + 2, blocktime + 2)
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(true)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(false)
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(true)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(false)
        // setting it again (one more transaction) with the same number will advance the blocktime and expire the rights
        await registryFromAdmin.setPublicPermission(streamId1, blocktime + 2, blocktime + 2)
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(false)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Publish))
            .to.equal(false)
        expect(await registryFromAdmin.hasPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(false)
        expect(await registryFromAdmin.hasDirectPermission(streamId1, user0Address, PermissionType.Subscribe))
            .to.equal(false)
    })

    it('positiveTest trustedSetStreams', async (): Promise<void> => {
        const STREAMS_TO_MIGRATE = 50
        const streamIds: string[] = []
        const users: string[] = []
        const metadatas: string[] = []
        const permissions = []
        for (let i = 0; i < STREAMS_TO_MIGRATE; i++) {
            const user = Wallet.createRandom()
            streamIds.push(`${user.address}/streamidbulkmigrate/id${i}`)
            users.push(user.address)
            metadatas.push(`metadata-${i}`)
            permissions.push({
                canEdit: true,
                canDelete: true,
                publishExpiration: MAX_INT,
                subscribeExpiration: MAX_INT,
                canGrant: true
            })
        }
        await registryFromMigrator.trustedSetStreams(streamIds, users, metadatas, permissions)
        for (let i = 0; i < STREAMS_TO_MIGRATE; i++) {
            expect(await registryFromAdmin.getStreamMetadata(streamIds[i])).to.equal(metadatas[i])
        }
    })

    it('positiveTest trustedSetPermissions', async (): Promise<void> => {
        const STREAMS_TO_MIGRATE = 50
        const streamIds: string[] = []
        const users: string[] = []
        const metadatas: string[] = []
        const permissions = []
        for (let i = 0; i < STREAMS_TO_MIGRATE; i++) {
            const user = Wallet.createRandom()
            streamIds.push(`${user.address}/streamidbulkmigrate/id${i}`)
            users.push(user.address)
            metadatas.push(`metadata-${i}`)
            permissions.push({
                canEdit: true,
                canDelete: true,
                publishExpiration: MAX_INT,
                subscribeExpiration: MAX_INT,
                canGrant: true
            })
        }
        await registryFromMigrator.trustedCreateStreams(streamIds, metadatas)
        await registryFromMigrator.trustedSetPermissions(streamIds, users, permissions)
        for (let i = 0; i < STREAMS_TO_MIGRATE; i++) {
            expect(await registryFromAdmin.getStreamMetadata(streamIds[i])).to.equal(metadatas[i])
        }
    })
})
