const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// List of RTSP stream URLs
const streams = [
  'rtsp://167.235.64.79:8554/stream1',
  // Add other stream URLs here
];

// Configuration
const baseOutputDir = './timelapse_frames';
const checkTimeout = 30000; // Timeout for stream availability check (30 seconds)

// Capture settings
const captureInterval = 60000; // Capture a frame every minute (60000 ms)
const jpegQuality = 80; // JPEG quality (0-100, higher is better quality but larger file size)
const outputWidth = 1280; // Output width in pixels (set to -1 to maintain aspect ratio)
const outputHeight = 720; // Output height in pixels (set to -1 to maintain aspect ratio)

// Array to store interval IDs for each stream
const intervalIds = [];

// Flag to indicate if the capture process should continue
let isCapturing = true;

// Function to ensure output directory exists
function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

// Function to extract stream number from URL
function extractStreamNumber(streamUrl) {
  const match = streamUrl.match(/\/stream(\d+)$/);
  return match ? match[1] : '0';
}

// Function to generate output path for a frame
function generateOutputPath(streamUrl, timestamp) {
  const streamNumber = extractStreamNumber(streamUrl);
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  const fileName = `s${streamNumber}-${year}-${month}-${day}-${hours}-${minutes}-${seconds}.jpg`;
  const streamDir = path.join(baseOutputDir, `stream_${streamNumber}`);
  ensureDirectoryExists(streamDir);
  return path.join(streamDir, fileName);
}

// Function to check if a stream is available
function checkStreamAvailability(streamUrl) {
  return new Promise((resolve) => {
    console.log(`Checking availability of stream: ${streamUrl}`);
    
    const tempOutputPath = path.join(baseOutputDir, 'temp_check.jpg');
    
    const ffmpeg = spawn('ffmpeg', [
      '-y',  // Overwrite output file if it exists
      '-loglevel', 'error',
      '-rtsp_transport', 'tcp',  // Use TCP for RTSP (more reliable than UDP)
      '-i', streamUrl,
      '-frames:v', '1',  // Capture only one frame
      '-q:v', '2',  // High quality
      tempOutputPath
    ]);

    let errorOutput = '';

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      console.log(`FFmpeg exit code: ${code}`);
      console.log(`FFmpeg error output: ${errorOutput}`);

      if (code === 0 && fs.existsSync(tempOutputPath)) {
        console.log(`Stream ${streamUrl} is available. Test frame captured successfully.`);
        fs.unlinkSync(tempOutputPath);  // Remove the temporary file
        resolve(true);
      } else {
        console.log(`Stream ${streamUrl} is not available. Reason: ${errorOutput || 'Unknown error'}`);
        resolve(false);
      }
    });

    // Set a timeout
    setTimeout(() => {
      ffmpeg.kill('SIGKILL');
      console.log(`Stream check timed out for ${streamUrl}`);
      resolve(false);
    }, checkTimeout);
  });
}

// Function to capture a frame from a stream
async function captureFrame(streamUrl) {
  if (!isCapturing) return;

  const isAvailable = await checkStreamAvailability(streamUrl);
  
  if (!isAvailable) {
    console.log(`Stream ${streamUrl} is not available. Skipping frame capture.`);
    return;
  }

  const timestamp = Date.now();
  const outputPath = generateOutputPath(streamUrl, timestamp);
  
  console.log(`Attempting to capture frame from stream ${streamUrl} to ${outputPath}`);

  const ffmpegArgs = [
    '-rtsp_transport', 'tcp',  // Use TCP for RTSP
    '-i', streamUrl,
    '-vframes', '1',
    '-q:v', jpegQuality.toString(),
  ];

  // Add resolution options if specified
  if (outputWidth > 0 && outputHeight > 0) {
    ffmpegArgs.push('-vf', `scale=${outputWidth}:${outputHeight}`);
  } else if (outputWidth > 0) {
    ffmpegArgs.push('-vf', `scale=${outputWidth}:-1`);
  } else if (outputHeight > 0) {
    ffmpegArgs.push('-vf', `scale=-1:${outputHeight}`);
  }

  ffmpegArgs.push(outputPath);

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  let errorOutput = '';

  ffmpeg.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });

  ffmpeg.on('close', (code) => {
    if (code === 0) {
      console.log(`Frame captured for stream ${streamUrl}: ${outputPath}`);
    } else {
      console.error(`FFmpeg process exited with code ${code}`);
      console.error(`Error output: ${errorOutput}`);
    }
  });
}

// Function to start capturing frames for all streams
function startCapture() {
  console.log('Starting time-lapse recording for all streams...');
  
  streams.forEach((streamUrl) => {
    // Capture a frame immediately
    captureFrame(streamUrl);
    
    // Set up interval for subsequent captures
    const intervalId = setInterval(() => captureFrame(streamUrl), captureInterval);
    intervalIds.push(intervalId);
  });
  
  console.log('Time-lapse recording started for all streams. Type "stop" to end the capture process.');
}

// Function to stop capturing frames
function stopCapture() {
  isCapturing = false;
  intervalIds.forEach(clearInterval);
  console.log('Time-lapse recording stopped.');
  process.exit(0);
}

// Set up readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.on('line', (input) => {
  if (input.toLowerCase() === 'stop') {
    stopCapture();
  }
});

// Start the capture process
startCapture();