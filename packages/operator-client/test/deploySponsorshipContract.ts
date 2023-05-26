import { Chain } from "@streamr/config"
import { utils, Wallet, Contract, ContractReceipt } from "ethers"

import { sponsorshipABI } from "@streamr/network-contracts"
import type { Sponsorship } from "@streamr/network-contracts"

const { parseEther } = utils

import { abi as sponsorshipFactoryAbi }
    from "../../network-contracts/artifacts/contracts/OperatorTokenomics/SponsorshipFactory.sol/SponsorshipFactory.json"

export async function deploySponsorship(
    chainConfig: Chain,
    deployer: Wallet, {
        streamId = `Stream-${Date.now()}`,
        metadata = "{}",
        minimumStakeWei = parseEther("60"),
        minHorizonSeconds = 0,
        minOperatorCount = 1,
    } = {},
): Promise<Sponsorship> {

    // console.log("Chain config: %o", chainConfig)
    const sponsorshipFactory = new Contract(chainConfig.contracts.SponsorshipFactory, sponsorshipFactoryAbi, deployer)
    // console.log("deployer balance", await deployer.getBalance())
    const sponsorshipDeployTx = await sponsorshipFactory.deploySponsorship(
        minimumStakeWei.toString(),
        minHorizonSeconds.toString(),
        minOperatorCount.toString(),
        streamId,
        metadata,
        [
            chainConfig.contracts.StakeWeightedAllocationPolicy,
            chainConfig.contracts.DefaultLeavePolicy,
            chainConfig.contracts.VoteKickPolicy,
        ], [
            parseEther("0.01"),
            "0",
            "0"
        ]
    )
    const sponsorshipDeployReceipt = await sponsorshipDeployTx.wait() as ContractReceipt
    const newSponsorshipEvent = sponsorshipDeployReceipt.events?.find((e) => e.event === "NewSponsorship")
    const newSponsorshipAddress = newSponsorshipEvent?.args?.sponsorshipContract
    const newSponsorship = new Contract(newSponsorshipAddress, sponsorshipABI, deployer) as unknown as Sponsorship

    return newSponsorship
}
