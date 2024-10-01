const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const baseInputDir = './timelapse_frames';
const videoOutputDir = './timelapse_videos';

// Video creation settings
const videoFrameRate = 30; // Frame rate for the output video

// Function to ensure output directory exists
function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

// Function to create a video from captured frames
function createVideo(streamNumber) {
  const now = new Date();
  const videoFileName = `timelapse_s${streamNumber}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}.mp4`;
  const videoOutputPath = path.join(videoOutputDir, videoFileName);

  const streamDir = path.join(baseInputDir, `stream_${streamNumber}`);
  const framePattern = path.join(streamDir, `s${streamNumber}-*.jpg`);

  console.log(`Creating video for stream ${streamNumber}: ${videoOutputPath}`);

  const ffmpegArgs = [
    '-framerate', videoFrameRate.toString(),
    '-pattern_type', 'glob',
    '-i', framePattern,
    '-vf', `select='not(mod(n,${videoFrameRate}))',setpts=N/TB/${videoFrameRate}`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '23',
    videoOutputPath
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  ffmpeg.stderr.on('data', (data) => {
    console.error(`FFmpeg stderr: ${data}`);
  });

  ffmpeg.on('close', (code) => {
    if (code === 0) {
      console.log(`Video created successfully: ${videoOutputPath}`);
      // Optionally, delete old frames here
    } else {
      console.error(`FFmpeg process exited with code ${code}`);
    }
  });
}

// Function to get list of stream numbers
function getStreamNumbers() {
  const streamDirs = fs.readdirSync(baseInputDir).filter(dir => dir.startsWith('stream_'));
  return streamDirs.map(dir => dir.split('_')[1]);
}

// Main function to create videos for all streams
function createVideosForAllStreams() {
  ensureDirectoryExists(videoOutputDir);
  const streamNumbers = getStreamNumbers();
  
  if (streamNumbers.length === 0) {
    console.log('No stream directories found. Make sure frames have been captured.');
    return;
  }

  streamNumbers.forEach(streamNumber => {
    createVideo(streamNumber);
  });
}

// Run the video creation process
createVideosForAllStreams();