/*
 * Hardhat should automatically detect the correct types. For example, the import style we use should work fine:
 * import { upgrades, ethers as hardhatEthers } from "hardhat"
 * 
 * However, for some reason, these imports failed without this type definition file. Compilation with "npx tsc" 
 * resulted in the following errors:
 * - Module '"hardhat"' has no exported member 'upgrades'
 * - Module '"hardhat"' has no exported member 'ethers'
 * 
 * The root cause might be that we are using outdated versions of Hardhat, OpenZeppelin, or Ethers, or our 
 * monorepo configuration might be incorrect. When upgrading Hardhat or related packages, we should
 * verify whether this file is still necessary.
 */ 
import type { ethers } from "ethers"
import type { HardhatUpgrades } from "@openzeppelin/hardhat-upgrades"
import "hardhat/types/runtime"

declare module "hardhat/types/runtime" {
    interface HardhatRuntimeEnvironment {
        ethers: typeof ethers & HardhatEthersHelpers
        upgrades: HardhatUpgrades
    }
}
