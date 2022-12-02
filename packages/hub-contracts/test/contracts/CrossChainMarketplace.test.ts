import { waffle, ethers as hardhatEthers } from "hardhat"
import { expect, use } from "chai"
import { utils } from "ethers"

const { hexlify, toUtf8Bytes } = utils
const { getContractFactory } = hardhatEthers

use(waffle.solidity)

describe.only('Cross-chain massaging', () => {
    it("should be able to send a message", async function () {
        const MockInbox = await getContractFactory("MockInbox")
        const MockOutbox = await getContractFactory("MockOutbox")
        const CrossChainRecipient = await getContractFactory("CrossChainRecipient")
    
        const inbox = await MockInbox.deploy()
        const outbox = await MockOutbox.deploy(inbox.address)
    
        const recipient = await CrossChainRecipient.deploy()
        const data = toUtf8Bytes("This is a test message")
        
        await outbox.dispatch(1, outbox.addressToBytes32(recipient.address), data)
        await inbox.processNextPendingMessage()
    
        const dataReceived = await recipient.data()
        expect(dataReceived).to.eql(hexlify(data))
    })
})
