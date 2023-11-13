import {ethers} from "ethers"

const configKeys = [
    "slashingFraction",
    "earlyLeaverPenaltyWei",
    "minimumSelfDelegationFraction",
    "minimumDelegationWei",
    "maxPenaltyPeriodSeconds",
    "maxQueueSeconds",
    "maxAllowedEarningsFraction",
    "fishermanRewardFraction",
    "protocolFeeFraction",
    "protocolFeeBeneficiary",
    "minEligibleVoterAge",
    "minEligibleVoterFractionOfAllStake",
    "flagReviewerCount",
    "flagReviewerRewardWei",
    "flaggerRewardWei",
    "flagReviewerSelectionIterations",
    "flagStakeWei",
    "reviewPeriodSeconds",
    "votingPeriodSeconds",
    "flagProtectionSeconds",
    "randomOracle",
    "trustedForwarder",
    "sponsorshipFactory",
    "operatorFactory",
    "voterRegistry",
    "operatorContractOnlyJoinPolicy",
    "streamRegistryAddress",
]

let lines = ""

for (const key of configKeys) {
    const value = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(key))
    lines += `const ${key}Key = "${value}"\n`
    
}

console.log(lines)
