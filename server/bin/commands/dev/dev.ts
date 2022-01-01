import { Command } from "commander";
import { terminal } from "../../../src/main";
import getConfig from "../../utils/getConfig";
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import chokidar, { FSWatcher } from "chokidar";
import fs from "fs-extra";

interface CommandOptions {
    /**
     * The app config
     */
    config: string;
}

/**
 * Exit the app and dev server
 */
function exitApp() {
    terminal.error("The dev server failed to start");
    terminal.error("Check debug log at (__DOES_NOT_EXIST__) for detailed information");
    process.exit();
}

/**
 * Initialize dev command
 * @param bin Commander program
 */
export default function dev(bin: Command) {
    bin
        .command("dev [path]")
        .option("--config <path>", "The path to your application's configuration file")
        .description("Start a development server")
        .action((pathName = "./", options: CommandOptions) => {
            getConfig(options.config).then((config) => {
                terminal.info(`The app will now boot in development for ${config.app.type} platforms`);
                terminal.info("The renderer process is starting in development");

                if (config.app.type == "desktop") {
                    startDesktopDevServer(path.join(process.cwd(), pathName)).then((port) => {
                        terminal.success("The development server has loaded on port " + port);
                        terminal.info("The desktop process is starting in development");

                        startDesktopDevApp(path.join(process.cwd(), pathName), port, [ ...config.app.desktop?.externalDirs!, config.app.desktop?.electronRoot! ]).then(() => {
                            terminal.success("The development app has been loaded");
                            terminal.success("App is fully ready for being developed");
                        });
                    });
                } else {
                    terminal.error("EUNIMP: Cannot deploy mobile applications on this version of LuxJS. Either update your LuxJS service or wait for an update");
                }
            });
        });
}

/**
 * Start a development server for desktop apps
 * @param rootPath The app's root path
 * @returns Promise for is the server started correctly, this will contain the server's listening port
 */
function startDesktopDevServer(rootPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const devServer = spawn("node", [ "./subProc/desktop/vite.js", rootPath ], {
            cwd: __dirname
        });

        let devServerListening = false;

        devServer.stdout.on("data", (bData) => {
            const data = bData.toString();

            if (!devServerListening) {
                const startReg = /  > Local: http:\/\/localhost:(.*?)\/\n/;

                if (startReg.test(data)) {
                    resolve(+startReg.exec(data)![1]);
                }
            }
        });
    });
}

/**
 * Start the ElectronJS app in dev
 * @param rootPath The app root
 * @param port Port of the dev server 
 * @returns A promise for when the app has been started
 */
function startDesktopDevApp(rootPath: string, serverPort: number, electronDirs: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        let devApp: ChildProcess;

        const startDevApp = () => {
            devApp = spawn("node", [ "./subProc/desktop/electron.js", rootPath, serverPort + "" ], {
                cwd: __dirname
            });
    
            let ready = false;
    
            devApp.stdout!.on("data", (d) => {
                const data = d.toString().split("\n") as string[];
    
                data.forEach(line => {
                    try {
                        const message = JSON.parse(line) as any;
    
                        if (!ready && message.boot && message.boot.done) {
                            ready = true;
                            resolve();
                        }
                    } catch (error) {
                        line.length > 0 && ready && terminal.info("[ Electron ] " + line);
                    };
                });
            });
        }

        startDevApp();
        const watchers = [] as FSWatcher[];

        electronDirs.forEach((dir, index) => {
            if (fs.existsSync(path.join(rootPath, dir))) {
                if (fs.lstatSync(path.join(rootPath, dir)).isDirectory()) {
                    watchers.push(chokidar.watch(path.join(rootPath, dir)));
                } else {
                    if (electronDirs.length == index + 1) {
                        terminal.error("The electron's root path is a file but should be a directory");
                    } else {
                        terminal.error("One or more of the electron external paths route to a file but should go to a directory instead");
                    }

                    exitApp();
                }
            } else {
                if (electronDirs.length == index + 1) {
                    terminal.error("The electron's root path is invalid");
                } else {
                    terminal.error("One or more of the electron external paths are invalid");
                }

                exitApp();
            }
        });

        watchers.forEach(watcher => {
            watcher.on("all", () => {
                devApp.kill();
                startDevApp();
            });
        });
    });
}
