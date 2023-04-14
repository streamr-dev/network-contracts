import { ethers } from "hardhat"
import { utils, Wallet } from "ethers"
import { signTypedData, SignTypedDataVersion, TypedMessage } from "@metamask/eth-sig-util"
import { MinimalForwarder } from "../../../typechain"

interface EIP2771MetaTx {
    request: {
        from: string
        to: string
        value: string
        gas: string
        nonce: string
        data: string
    }
    signature: string
}

/** @dev see https://eips.ethereum.org/EIPS/eip-2771 */
export async function getEIP2771MetaTx(to: string, data: string, forwarder: MinimalForwarder, signer: Wallet, gas?: string): Promise<EIP2771MetaTx> {
    const request = {
        from: signer.address,
        to,
        value: "0",
        gas: gas ? gas : "1000000",
        nonce: (await forwarder.getNonce(signer.address)).toString(),
        data
    }
    const d: TypedMessage<any> = {
        domain: {
            name: "MinimalForwarder",
            version: "0.0.1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: forwarder.address,
        },
        primaryType: "ForwardRequest",
        message: request,
        types: {
            EIP712Domain: [
                { name: "name", type: "string" },
                { name: "version", type: "string" },
                { name: "chainId", type: "uint256" },
                { name: "verifyingContract", type: "address" },
            ],
            ForwardRequest: [
                { name: "from", type: "address" },
                { name: "to", type: "address" },
                { name: "value", type: "uint256" },
                { name: "gas", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "data", type: "bytes" },
            ],
        },
    }
    const options = {
        data: d,
        privateKey: utils.arrayify(signer.privateKey) as Buffer,
        version: SignTypedDataVersion.V4,
    }
    const signature = signTypedData(options)
    return { request, signature }
}
