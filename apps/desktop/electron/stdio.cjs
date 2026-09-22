function protectStdio(streams = [process.stdout, process.stderr]) {
  for (const stream of streams) {
    // GUI launchers can close inherited log pipes. IPC errors must still reach the UI.
    stream.on('error', error => {
      if (error.code !== 'EPIPE') throw error;
    });
  }
}

module.exports = { protectStdio };
