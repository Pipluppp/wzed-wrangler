const stage = await Deno.makeTempDir({ prefix: "wzed-wrangler-deploy-" });

async function copyDirectory(
  source: string,
  destination: string,
): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const sourcePath = `${source}/${entry.name}`;
    const destinationPath = `${destination}/${entry.name}`;
    if (entry.isDirectory) {
      await copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile) {
      await Deno.copyFile(sourcePath, destinationPath);
    }
  }
}

try {
  await copyDirectory("dist", `${stage}/out`);
  await copyDirectory("relay-deno", `${stage}/relay-deno`);
  await Deno.copyFile("relay-deno/deno.json", `${stage}/deno.json`);
  await Deno.copyFile("relay-deno/deno.lock", `${stage}/deno.lock`);

  console.log(`Deploying staged application from ${stage}`);
  const command = new Deno.Command(Deno.execPath(), {
    args: ["deploy", ...Deno.args],
    cwd: stage,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const result = await command.output();
  if (!result.success) Deno.exit(result.code);
} finally {
  await Deno.remove(stage, { recursive: true });
}
