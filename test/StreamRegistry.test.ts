import { waffle, network, ethers } from 'hardhat'
import { expect, use } from 'chai'

import StreamRegistryJson from '../artifacts/contracts/StreamRegistry/StreamRegistry.sol/StreamRegistry.json'
import { StreamRegistry } from '../typechain/StreamRegistry'

const { deployContract } = waffle
const { provider } = waffle

use(waffle.solidity)

describe('PermissionRegistry', (): void => {
    const wallets = provider.getWallets()
    let registryFromAdmin: StreamRegistry
    let registryFromUser0: StreamRegistry
    // let registryFromUser1: StreamRegistry
    const adminAdress = wallets[0].address
    const user0Address = wallets[1].address
    const user1Address = wallets[2].address
    const streamPath1: string = '/streamPath1'
    const streamPath2: string = '/streamPath2'
    const streamId1: string = adminAdress.toLowerCase() + streamPath1
    const streamId2: string = adminAdress.toLowerCase() + streamPath2
    const metadata1: string = 'streammetadata1'
    const metadata2: string = 'streammetadata2'

    before(async (): Promise<void> => {
        registryFromAdmin = await deployContract(wallets[0], StreamRegistryJson) as StreamRegistry
        registryFromUser0 = registryFromAdmin.connect(wallets[1])
        // registryFromUser1 = registryFromAdmin.connect(wallets[2])
    })

    it('positivetest createStream, get description', async (): Promise<void> => {
        await expect(await registryFromAdmin.createStream(streamPath1, metadata1))
            .to.emit(registryFromAdmin, 'StreamCreated')
            .withArgs(streamId1, metadata1)
        // const addresskey = await registryFromAdmin.getAddressKey(streamId, adminAdress)
        expect(await registryFromAdmin.streamIdToMetadata(streamId1)).to.equal(metadata1)
        // const permissions = await registryFromAdmin.streamIdToPermissions(streamId, addresskey)
        // expect(permissions.edit).to.equal(true)
        // expect(permissions.publishRights).to.equal(1)
        // expect(permissions.subscriptionExpirationTime).to.equal(0)
        // expect(await registryFromAdmin.getDescription(streamID)).to.equal('a')
    })

    it('negativetest createStream, already exists error', async (): Promise<void> => {
        await expect(registryFromAdmin.createStream(streamPath1, metadata1))
            .to.be.revertedWith('stream id alreay exists')
    })

    it('positivetest getStreamMetadata', async (): Promise<void> => {
        expect(await registryFromAdmin.getStreamMetadata(streamId1)).to.equal(metadata1)
    })

    it('negativetest getStreamMetadata, stream doesnt exist', async (): Promise<void> => {
        await expect(registryFromAdmin.getStreamMetadata(streamId2)).to.be.revertedWith('stream does not exist')
    })

    it('positivetest updateStreamMetadata', async (): Promise<void> => {
        expect(await registryFromAdmin.getStreamMetadata(streamId1)).to.equal(metadata1)
        await registryFromAdmin.updateStreamMetadata(streamId1, metadata2)
        expect(await registryFromAdmin.getStreamMetadata(streamId1)).to.equal(metadata2)
    })

    it('negativetest updateStreamMetadata, not exist, no right', async (): Promise<void> => {
        await expect(registryFromAdmin.updateStreamMetadata(streamId2, metadata1))
            .to.be.revertedWith('stream does not exist')
        await expect(registryFromUser0.updateStreamMetadata(streamId1, metadata1))
            .to.be.revertedWith('no edit permission')
    })

    it('positivetest deleteStream', async (): Promise<void> => {
        expect(await registryFromAdmin.getStreamMetadata(streamId1)).to.equal(metadata2)
        await registryFromAdmin.deleteStream(streamId1)
        await expect(registryFromAdmin.updateStreamMetadata(streamId1, metadata1))
            .to.be.revertedWith('stream does not exist')
    })

    it('negativetest deleteStream, not exist, no right', async (): Promise<void> => {
        await registryFromAdmin.createStream(streamPath1, metadata1)
        await expect(registryFromAdmin.deleteStream(streamId2))
            .to.be.revertedWith('stream does not exist')
        await expect(registryFromUser0.deleteStream(streamId1))
            .to.be.revertedWith('no delete permission')
    })


    /* it('item doesn\'t exist error', async (): Promise<void> => {
        // item id 2 doesn't exist
        await expect(registryFromAdmin.editItem(999, 'b')).to.be.reverted
        await expect(registryFromAdmin.getDescription(999)).to.be.reverted
        // await expect(registryFromAdmin.grantPermissions(2, wallets[1].address, [true, true, true])).to.be.reverted
        // await expect(registryFromAdmin.hasPermission(2, wallets[1].address, 'view')).to.be.reverted
        // await expect(registryFromAdmin.getPermissions(2, wallets[1].address)).to.be.reverted
    })
    it('admin transfers view rights to user0', async (): Promise<void> => {
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
        //const tr2 = await ethers.provider.getTransactionReceipt(transaction.hash)
        const permissionsUser0 = await registryFromAdmin.streamIdToPermissions(streamID, user0Address)
        expect(permissionsUser0.isAdmin).to.equal(false)
        const blocknumber = await ethers.provider.getBlockNumber()
        const block = await ethers.provider.getBlock(blocknumber)
        const timeAfterTransacion = block.timestamp
        expect(permissionsUser0.subscriptionExpirationTime).to.equal(timeAfterTransacion
             + amountViewTimeToTransfer)
        expect(permissionsUser0.publishRights).to.equal(0)
    })
    it('user0 transfers view rights to user1', async (): Promise<void> => {
        const amountViewRightsToTransfer = 2
        await registryFromUser0.transferViewTime(streamID, user1Address, amountViewRightsToTransfer)
        // make sure user0 got read permission
        const permissionsUser0 = await registryFromAdmin.streamIdToPermissions(streamID, user0Address)
        expect(permissionsUser0.isAdmin).to.equal(false)
        expect(permissionsUser0.subscriptionExpirationTime).to.equal(1) // he has one left
        expect(permissionsUser0.publishRights).to.equal(0)
        const permissionsUser1 = await registryFromAdmin.streamIdToPermissions(streamID, user1Address)
        expect(permissionsUser1.isAdmin).to.equal(false)
        expect(permissionsUser1.subscriptionExpirationTime).to.equal(amountViewRightsToTransfer) // he has one left
        expect(permissionsUser1.publishRights).to.equal(0)
    })
    it('admin transfers publish rights to user0', async (): Promise<void> => {
        const amountViewRightsToTransfer = 3
        await registryFromAdmin.transferPublishRights(streamID, user0Address, amountViewRightsToTransfer)
        // make sure user0 got read permission
        const permissionsUser0 = await registryFromAdmin.streamIdToPermissions(streamID, user0Address)
        expect(permissionsUser0.isAdmin).to.equal(false)
        expect(permissionsUser0.subscriptionExpirationTime).to.equal(1)
        expect(permissionsUser0.publishRights).to.equal(amountViewRightsToTransfer)
    })
    it('user0 transfers publish rights to user1', async (): Promise<void> => {
        const amountViewRightsToTransfer = 2
        await registryFromUser0.transferPublishRights(streamID, user1Address, amountViewRightsToTransfer)
        // make sure user0 got read permission
        const permissionsUser0 = await registryFromAdmin.streamIdToPermissions(streamID, user0Address)
        expect(permissionsUser0.isAdmin).to.equal(false)
        expect(permissionsUser0.subscriptionExpirationTime).to.equal(1)
        expect(permissionsUser0.publishRights).to.equal(1)
        let permissionsUser1 = await registryFromAdmin.streamIdToPermissions(streamID, user1Address)
        expect(permissionsUser1.isAdmin).to.equal(false)
        expect(permissionsUser1.subscriptionExpirationTime).to.equal(2)
        expect(permissionsUser1.publishRights).to.equal(amountViewRightsToTransfer)
        // transfer the remaining one as well, so none are left
        await registryFromUser0.transferPublishRights(streamID, user1Address, 1)
        permissionsUser1 = await registryFromAdmin.streamIdToPermissions(streamID, user1Address)
        expect(permissionsUser1.isAdmin).to.equal(false)
        expect(permissionsUser1.subscriptionExpirationTime).to.equal(2)
        expect(permissionsUser1.publishRights).to.equal(3)
    }) */
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
    //     await registryFromAcc2.editItem(1, 'b')
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
    //     await expect(registryFromAcc2.editItem(1, 'b')).to.be.reverted
    // })
    // it('negativetest other user can grant', async (): Promise<void> => {
    //     await expect(registryFromAcc2.grantPermissions(1, wallets[2].address, [true, true, true])).to.be.reverted
    // })
})
