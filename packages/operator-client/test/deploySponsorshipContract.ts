import { Chain } from "@streamr/config"
import { utils, Wallet, Contract, ContractReceipt } from "ethers"

import type { Sponsorship } from "../../network-contracts/typechain"

const { parseEther } = utils

import { abi as sponsorshipFactoryAbi }
    from "../../network-contracts/artifacts/contracts/OperatorTokenomics/SponsorshipFactory.sol/SponsorshipFactory.json"

export async function deploySponsorship(deployer: Wallet,
    chainConfig: Chain, {
        streamId = `Stream-${Date.now()}`,
        metadata = "{}",
        minimumStakeWei = parseEther("60"),
        minHorizonSeconds = 0,
        minOperatorCount = 1,
    } = {},
): Promise<Sponsorship> {

    const sponsorshipFactory = new Contract(chainConfig.contracts.OperatorFactory, sponsorshipFactoryAbi, deployer)

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
    const newSponsorship = new Contract(newSponsorshipAddress, sponsorshipFactoryAbi, deployer) as Sponsorship
    return newSponsorship
}
