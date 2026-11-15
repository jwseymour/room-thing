// Prints the addresses to open on your phone before the server starts.
import os from "node:os";

const port = process.env.PORT ?? 3000;
const addresses = Object.entries(os.networkInterfaces())
  .flatMap(([name, nets]) =>
    (nets ?? [])
      .filter((net) => net.family === "IPv4" && !net.internal)
      .map((net) => ({ name, address: net.address })),
  );

console.log(`\nOn this laptop:  http://localhost:${port}`);
if (addresses.length === 0) {
  console.log("On your phone:   not on a network yet");
}
for (const { name, address } of addresses) {
  console.log(`On your phone:   http://${address}:${port}  (${name})`);
}
console.log("");
