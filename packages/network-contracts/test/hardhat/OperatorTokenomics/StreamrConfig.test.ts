import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"

import type { Wallet } from "ethers"
import type { StreamrConfig } from "../../../typechain"

const { getSigners, getContractFactory } = hardhatEthers

describe("StreamrConfig", (): void => {
    let admin: Wallet
    let streamrConfig: StreamrConfig

    before(async (): Promise<void> => {
        [admin] = await getSigners() as Wallet[]
        streamrConfig = await (await getContractFactory("StreamrConfig", { signer: admin })).deploy() as StreamrConfig
        await streamrConfig.deployed()
        await(await streamrConfig.initialize()).wait()
    })

    describe("Pseudorandom number generator", (): void => {
        it("always gives back a different number on subsequent calls (100 tries)", async function(): Promise<void> {
            const numbers = new Set()
            for (let i = 0; i < 100; i++) {
                // use static call to grab the return value (like a smart contract would)
                const number = await streamrConfig.callStatic.bestEffortRandomBytes32()
                // use normal tx to update the pseudorandomState (that also happens in the same smart contract call)
                await (await streamrConfig.bestEffortRandomBytes32()).wait()
                numbers.add(number)
            }
            expect(numbers.size).to.equal(100)
        })

        it("always gives back the same sequence for the given seed", async function(): Promise<void> {
            const c = streamrConfig.callStatic

            // try different seeds
            await (await streamrConfig.setPseudorandomSeed("0x0000000000000000000000000000000000000000000000000000000000000000")).wait()
            expect(await c.bestEffortRandomBytes32()).to.equal("0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563")
            await (await streamrConfig.setPseudorandomSeed("0x1337133713371337133713371337133713371337133713371337133713371337")).wait()
            expect(await c.bestEffortRandomBytes32()).to.equal("0xbbc426f45dc6409f13c7d4ba4be0606687808ad811da04d9c726459958478661")

            // take several in sequence
            await (await streamrConfig.setPseudorandomSeed("0x1234567812345678123456781234567812345678123456781234567812345678")).wait()
            expect(await c.bestEffortRandomBytes32()).to.equal("0x3d6b7104c741bf23615b1bb00e067e9ef51c8ba2ab40042ee05086c14870f17c")
            await (await streamrConfig.bestEffortRandomBytes32()).wait()
            expect(await c.bestEffortRandomBytes32()).to.equal("0xefb23dc3fa8934192280d273e635ba2f834d729dab81abe97de286f2fa736067")
            await (await streamrConfig.bestEffortRandomBytes32()).wait()
            expect(await c.bestEffortRandomBytes32()).to.equal("0x4d0f582c99fbda717d8870ac9c3214cd876598bc97c78a7535dd4575c8c8ff2e")
            await (await streamrConfig.bestEffortRandomBytes32()).wait()
            expect(await c.bestEffortRandomBytes32()).to.equal("0x9d99118ce97f78d9e27cc9e6146b222a68fd6dadd7a1b2a3647053b8a0a427da")
        })
    })
})
