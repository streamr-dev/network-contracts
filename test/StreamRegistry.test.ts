import { waffle, ethers } from 'hardhat'
import { expect, use } from 'chai'

// eslint-disable-next-line max-len
import StreamRegistryJson from '../artifacts/contracts/StreamRegistry/StreamRegistryTimeBased.sol/StreamRegistryTimeBased.json'
import { StreamRegistryTimeBased } from '../typechain/StreamRegistryTimeBased'

const { deployContract } = waffle
const { provider } = waffle

use(waffle.solidity)

describe('PermissionRegistry', (): void => {
    const wallets = provider.getWallets()
    let registryFromAdmin: StreamRegistryTimeBased
    let registryFromUser0: StreamRegistryTimeBased
    // let registryFromUser1: StreamRegistry
    let streamID: number
    const adminAdress = wallets[0].address
    const user0Address = wallets[1].address
    const user1Address = wallets[2].address

    before(async (): Promise<void> => {
        registryFromAdmin = await deployContract(wallets[0], StreamRegistryJson) as StreamRegistryTimeBased
        registryFromUser0 = registryFromAdmin.connect(wallets[1])
        // registryFromUser1 = registryFromAdmin.connect(wallets[2])
    })

    it('create stream, get description', async (): Promise<void> => {
        streamID = 1
        await expect(await registryFromAdmin.createStream('a'))
            .to.emit(registryFromAdmin, 'StreamCreated')
            .withArgs(streamID, adminAdress, 'a')
        expect(await registryFromAdmin.streamIdToMetadata(streamID)).to.equal('a')
        const permissions = await registryFromAdmin.streamIdToPermissions(streamID, adminAdress)
        expect(permissions.isAdmin).to.equal(true)
        expect(permissions.publishRights).to.equal(1)
        expect(permissions.subscriptionExpirationTime).to.equal(0)
        expect(await registryFromAdmin.getDescription(streamID)).to.equal('a')
    })
    // it('item already exists error', async (): Promise<void> => {
    //     await expect(registryFromAdmin.createStream(1, 'c')).to.be.reverted
    // })
    it('edit stream', async (): Promise<void> => {
        await registryFromAdmin.editStream(1, 'b')
        expect(await registryFromAdmin.getDescription(streamID)).to.equal('b')
        // await expect(registryFromAdmin.grantPermissions(2, wallets[1].address, [true, true, true])).to.be.reverted
        // await expect(registryFromAdmin.hasPermission(2, wallets[1].address, 'view')).to.be.reverted
        // await expect(registryFromAdmin.getPermissions(2, wallets[1].address)).to.be.reverted
    })
    it('delete stream', async (): Promise<void> => {
        await expect(await registryFromAdmin.createStream('a'))
            .to.emit(registryFromAdmin, 'StreamCreated')
            .withArgs(2, adminAdress, 'a')
        await registryFromAdmin.deleteStream(2)
        await expect(registryFromAdmin.getDescription(2)).to.be.reverted
        // await expect(registryFromAdmin.grantPermissions(2, wallets[1].address, [true, true, true])).to.be.reverted
        // await expect(registryFromAdmin.hasPermission(2, wallets[1].address, 'view')).to.be.reverted
        // await expect(registryFromAdmin.getPermissions(2, wallets[1].address)).to.be.reverted
    })
    it('item doesn\'t exist error', async (): Promise<void> => {
        // item id 2 doesn't exist
        await expect(registryFromAdmin.editStream(999, 'b')).to.be.reverted
        await expect(registryFromAdmin.getDescription(999)).to.be.reverted
        // await expect(registryFromAdmin.grantPermissions(2, wallets[1].address, [true, true, true])).to.be.reverted
        // await expect(registryFromAdmin.hasPermission(2, wallets[1].address, 'view')).to.be.reverted
        // await expect(registryFromAdmin.getPermissions(2, wallets[1].address)).to.be.reverted
    })
    it('admin transfers some view time to user0', async (): Promise<void> => {
        const amountViewTimeToTransfer = 60 * 60 // one hour
        // const ethersprovider = ethers.provider
        // const blocknumber = await ethersprovider.getBlockNumber()
        // const block = await ethersprovider.getBlock(blocknumber)
        // const timeBeforeTransacion = block.timestamp
        // const timetiIncreaseBlocktime = 15
        // await ethers.provider.send('evm_increaseTime', [timetiIncreaseBlocktime])
        await registryFromAdmin.transferViewTime(streamID, user0Address, amountViewTimeToTransfer)
        // make sure user0 got read permission
        // const tr1 = await ethers.provider.getTransaction(transaction.hash)
        // const tr2 = await ethers.provider.getTransactionReceipt(transaction.hash)
        const permissionsUser0 = await registryFromAdmin.streamIdToPermissions(streamID, user0Address)
        expect(permissionsUser0.isAdmin).to.equal(false)
        // get timestamp of next block (if there are some blocks in between, get block with transaction in it)
        const blocknumber = await ethers.provider.getBlockNumber()
        const block = await ethers.provider.getBlock(blocknumber)
        const timeAfterTransacion = block.timestamp
        expect(permissionsUser0.subscriptionExpirationTime).to.equal(timeAfterTransacion
             + amountViewTimeToTransfer)
        expect(permissionsUser0.publishRights).to.equal(0)
    })
    it('user0 transfers some view time to user1', async (): Promise<void> => {
        let permissionsUser0 = await registryFromAdmin.streamIdToPermissions(streamID, user0Address)
        const viewTiemBeforeTransfer = permissionsUser0.subscriptionExpirationTime.toNumber()
        const amountViewRightsToTransfer = 60 * 30 // half an hour

        await registryFromUser0.transferViewTime(streamID, user1Address, amountViewRightsToTransfer)

        permissionsUser0 = await registryFromAdmin.streamIdToPermissions(streamID, user0Address)
        expect(permissionsUser0.isAdmin).to.equal(false)
        expect(permissionsUser0.subscriptionExpirationTime)
            .to.equal(viewTiemBeforeTransfer - amountViewRightsToTransfer)
        expect(permissionsUser0.publishRights).to.equal(0)

        const blocknumber = await ethers.provider.getBlockNumber()
        const block = await ethers.provider.getBlock(blocknumber)
        const timeAfterTransacion = block.timestamp
        const permissionsUser1 = await registryFromAdmin.streamIdToPermissions(streamID, user1Address)
        expect(permissionsUser1.isAdmin).to.equal(false)
        expect(permissionsUser1.subscriptionExpirationTime).to.equal(timeAfterTransacion + amountViewRightsToTransfer)
        expect(permissionsUser1.publishRights).to.equal(0)
    })
    it('admin transfers publish rights to user0', async (): Promise<void> => {
        const amountViewRightsToTransfer = 3
        let permissionsUser0 = await registryFromAdmin.streamIdToPermissions(streamID, user0Address)
        const subscriptionTimeBeforeTransfer = permissionsUser0.subscriptionExpirationTime
        await registryFromAdmin.transferPublishRights(streamID, user0Address, amountViewRightsToTransfer)
        // make sure user0 got read permission
        permissionsUser0 = await registryFromAdmin.streamIdToPermissions(streamID, user0Address)
        expect(permissionsUser0.isAdmin).to.equal(false)
        expect(permissionsUser0.subscriptionExpirationTime).to.equal(subscriptionTimeBeforeTransfer)
        expect(permissionsUser0.publishRights).to.equal(amountViewRightsToTransfer)
    })
    it('user0 transfers publish rights to user1', async (): Promise<void> => {
        const amountViewRightsToTransfer = 2
        let permissionsUser0 = await registryFromAdmin.streamIdToPermissions(streamID, user0Address)
        const subscriptionTimeUser0BeforeTransfer = permissionsUser0.subscriptionExpirationTime
        let permissionsUser1 = await registryFromAdmin.streamIdToPermissions(streamID, user1Address)
        const subscriptionTimeUser1BeforeTransfer = permissionsUser1.subscriptionExpirationTime

        await registryFromUser0.transferPublishRights(streamID, user1Address, amountViewRightsToTransfer)

        permissionsUser0 = await registryFromAdmin.streamIdToPermissions(streamID, user0Address)
        expect(permissionsUser0.isAdmin).to.equal(false)
        expect(permissionsUser0.subscriptionExpirationTime).to.equal(subscriptionTimeUser0BeforeTransfer)
        expect(permissionsUser0.publishRights).to.equal(1)
        permissionsUser1 = await registryFromAdmin.streamIdToPermissions(streamID, user1Address)
        expect(permissionsUser1.isAdmin).to.equal(false)
        expect(permissionsUser1.subscriptionExpirationTime).to.equal(subscriptionTimeUser1BeforeTransfer)
        expect(permissionsUser1.publishRights).to.equal(amountViewRightsToTransfer)

        // transfer the remaining one as well, so none are left
        await registryFromUser0.transferPublishRights(streamID, user1Address, 1)

        permissionsUser1 = await registryFromAdmin.streamIdToPermissions(streamID, user1Address)
        expect(permissionsUser1.isAdmin).to.equal(false)
        expect(permissionsUser1.subscriptionExpirationTime).to.equal(subscriptionTimeUser1BeforeTransfer)
        expect(permissionsUser1.publishRights).to.equal(3)
    })
    // it('granting permission of item to another address', async (): Promise<void> => {
    //     await registryFromAdmin.grantPermissions(1, wallets[1].address, [true, true, true])
    //     expect('grantPermissions').to.be.calledOnContract(registryFromAdmin)
    // })
    // it('get single permission on item', async (): Promise<void> => {
    //     expect(await registryFromAdmin.hasPermission(1, wallets[1].address, 'view')).to.equal(true)
    //     expect(await registryFromAdmin.hasPermission(1, wallets[1].address, 'edit')).to.equal(true)
    //     expect(await registryFromAdmin.hasPermission(1, wallets[1].address, 'grant')).to.equal(true)
    // })
    // it('get wrong permission name', async (): Promise<void> => {
    //     await expect(registryFromAdmin.hasPermission(1, wallets[1].address), 'asdf').to.be.reverted
    // })
    // it('read permissions on item', async (): Promise<void> => {
    //     expect(await registryFromAdmin.getPermissions(1, wallets[1].address)).to.deep.equal([true, true, true])
    // })

    // it('positivetest other user can view', async (): Promise<void> => {
    //     expect(await registryFromAcc2.getDescription(1)).to.equal('a')
    // })
    // it('positivetest other user can edit', async (): Promise<void> => {
    //     await registryFromAcc2.editStream(1, 'b')
    //     expect('editItem').to.be.calledOnContract(registryFromAcc2)
    //     expect(await registryFromAcc2.getDescription(1)).to.equal('b')
    // })
    // it('positivetest other user can grant', async (): Promise<void> => {
    //     await registryFromAcc2.grantPermissions(1, wallets[2].address, [true, true, true])
    //     expect('grantPermissions').to.be.calledOnContract(registryFromAcc2)
    //     expect(await registryFromAcc2.getPermissions(1, wallets[2].address)).to.deep.equal([true, true, true])
    // })

    // it('negativetest other user can view', async (): Promise<void> => {
    //     await registryFromAdmin.grantPermissions(1, wallets[1].address, [false, false, false])

    //     await expect(registryFromAcc2.getDescription(1)).to.be.reverted
    // })
    // it('negativetest other user can edit', async (): Promise<void> => {
    //     await expect(registryFromAcc2.editStream(1, 'b')).to.be.reverted
    // })
    // it('negativetest other user can grant', async (): Promise<void> => {
    //     await expect(registryFromAcc2.grantPermissions(1, wallets[2].address, [true, true, true])).to.be.reverted
    // })
})
