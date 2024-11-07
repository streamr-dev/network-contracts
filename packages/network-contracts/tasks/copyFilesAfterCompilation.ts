import { copyFileSync } from "fs"

import { task } from "hardhat/config"
import { TASK_COMPILE } from "hardhat/builtin-tasks/task-names"

declare module "hardhat/types/config" {
    interface HardhatUserConfig {
        /** Copy files after compilation has finished successfully
         * @param from Source file to copy
         * @param to Destination filename
         */
        copyFilesAfterCompilation?: {
            from: string,
            /** Destination directory + filename */
            to: string,
            /** Only show warning if file is missing */
            optional?: boolean,
        }[];
    }

    interface HardhatConfig {
        copyFilesAfterCompilation: [{
            from: string,
            to: string,
            optional?: boolean,
        }]
    }
}

task(TASK_COMPILE, async (_, hre, runSuper) => {
    await runSuper()
    hre?.config?.copyFilesAfterCompilation?.forEach(({ from, to, optional }) => {
        try {
            copyFileSync(from, to)
        } catch (e) {
            if (!optional) {
                throw e
            } else {
                console.warn(e)
            }
        }
    })
})
