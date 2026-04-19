import * as path from "node:path";
import { glob } from "glob";
import Mocha from "mocha";

export async function run(): Promise<void> {
	const mocha = new Mocha({
		ui: "tdd",
		color: true,
		timeout: 20_000,
	});

	const testsRoot = __dirname;
	const files = await glob("**/*.test.js", { cwd: testsRoot });

	for (const file of files) {
		mocha.addFile(path.resolve(testsRoot, file));
	}

	await new Promise<void>((resolve, reject) => {
		try {
			mocha.run((failures) => {
				if (failures > 0) {
					reject(new Error(`${failures} tests failed.`));
				} else {
					resolve();
				}
			});
		} catch (err) {
			reject(err);
		}
	});
}
