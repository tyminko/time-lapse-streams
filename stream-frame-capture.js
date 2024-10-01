const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const readline = require('readline')

// List of RTSP stream URLs
const streams = [
  'rtsp://167.235.64.79:8554/stream6',
  'rtsp://167.235.64.79:8554/stream7',
  'rtsp://167.235.64.79:8554/stream8',
  'rtsp://167.235.64.79:8554/stream9',
  'rtsp://167.235.64.79:8554/stream10',
  'rtsp://167.235.64.79:8554/stream11',
  'rtsp://167.235.64.79:8554/stream12',
]

// Configuration
const primaryOutputDir = '/media/pi/4A/timelapse_frames'
const fallbackOutputDir = './timelapse_frames'
const baseOutputDir = fs.existsSync(primaryOutputDir) ? primaryOutputDir : fallbackOutputDir

const captureInterval = 60000 // Capture a frame every minute (60000 ms) during working hours
const jpegQuality = 80 // JPEG quality (0-100, higher is better quality)
const outputWidth = 1920 // Output width in pixels (set to -1 or 0 to maintain aspect ratio)
const outputHeight = 1080 // Output height in pixels (set to -1 or 0 to maintain aspect ratio)

// Kharkiv time zone offset (in minutes)
const kharkivOffset = 180 // UTC+3

// Working hours in Kharkiv time
const workingHoursStart = 12 // 12:00
const workingHoursEnd = 19 // 19:00
const morningCheckTime = 10 // 10:00

// Error handling configuration
const maxRetries = 3 // Maximum number of immediate retries
const maxBackoffInterval = 3600000 // Maximum backoff interval (1 hour)

let isCapturing = true

// Helper function to get current time in Kharkiv
function getKharkivTime() {
  const now = new Date()
  return new Date(now.getTime() + (kharkivOffset + now.getTimezoneOffset()) * 60000)
}

// Helper function to check if it's a working day (not Monday)
function isWorkingDay() {
  const kharkivTime = getKharkivTime()
  return kharkivTime.getDay() !== 1 // 1 is Monday
}

// Helper function to check if it's within working hours
function isWorkingHours() {
  const kharkivTime = getKharkivTime()
  const hours = kharkivTime.getHours()
  return hours >= workingHoursStart && hours < workingHoursEnd
}

// Helper function to get next check time
function getNextCheckTime(failedAttempts) {
  const kharkivTime = getKharkivTime()
  const currentHour = kharkivTime.getHours()

  if (isWorkingDay()) {
    if (currentHour >= workingHoursEnd) {
      // After working hours, wait until next morning check
      const nextDay = new Date(kharkivTime)
      nextDay.setDate(nextDay.getDate() + 1)
      nextDay.setHours(morningCheckTime, 0, 0, 0)
      return nextDay.getTime() - Date.now()
    } else if (currentHour < morningCheckTime) {
      // Before morning check time
      return (morningCheckTime - currentHour) * 3600000
    } else if (currentHour < workingHoursStart) {
      // Between morning check and working hours start
      const baseInterval = 600000 // 10 minutes
      const timeUntilStart = (workingHoursStart - currentHour) * 3600000
      return Math.min(baseInterval * Math.pow(2, failedAttempts), timeUntilStart)
    } else {
      // During working hours
      return Math.min(captureInterval * Math.pow(2, failedAttempts), maxBackoffInterval)
    }
  } else {
    // Monday
    if (currentHour >= workingHoursEnd) {
      // After working hours, wait until next morning
      const nextDay = new Date(kharkivTime)
      nextDay.setDate(nextDay.getDate() + 1)
      nextDay.setHours(morningCheckTime, 0, 0, 0)
      return nextDay.getTime() - Date.now()
    } else {
      // During the day on Monday
      return Math.min(3600000, (workingHoursEnd - currentHour) * 3600000) // Check every hour or less
    }
  }
}

// Function to ensure output directory exists
function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true })
  }
}

// Function to extract stream number from URL
function extractStreamNumber(streamUrl) {
  const match = streamUrl.match(/\/stream(\d+)$/)
  return match ? match[1] : '0'
}

// Function to generate output path for a frame
function generateOutputPath(streamUrl, timestamp) {
  const streamNumber = extractStreamNumber(streamUrl)
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  
  const fileName = `s${streamNumber}-${year}-${month}-${day}-${hours}-${minutes}-${seconds}.jpg`
  const streamDir = path.join(baseOutputDir, `stream_${streamNumber}`)
  ensureDirectoryExists(streamDir)
  return path.join(streamDir, fileName)
}

// Function to convert 0-100 quality to FFmpeg's 2-31 scale
function convertJpegQuality(quality) {
  quality = Math.max(0, Math.min(100, quality))
  return Math.round(((100 - quality) / 100) * 29 + 2)
}

async function captureFrame(streamUrl) {
  if (!isCapturing) return false

  const timestamp = Date.now()
  const outputPath = generateOutputPath(streamUrl, timestamp)
  
  console.log(`${streamName(streamUrl)}: attempting to capture`)

  const ffmpegQuality = convertJpegQuality(jpegQuality)

  const ffmpegArgs = [
    '-rtsp_transport', 'tcp',
    '-i', streamUrl,
    '-frames:v', '1',
    '-c:v', 'mjpeg',
    '-q:v', ffmpegQuality.toString(),
    '-f', 'image2',
    '-update', '1'
  ]

  if (outputWidth > 0 || outputHeight > 0) {
    const scaleFilter = `scale=${outputWidth > 0 ? outputWidth : -1}:${outputHeight > 0 ? outputHeight : -1}`
    ffmpegArgs.push('-vf', scaleFilter)
  }

  ffmpegArgs.push(outputPath)

  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs)

    let errorOutput = ''

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString()
    })

    ffmpeg.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        console.log(`${streamName(streamUrl)}: ${outputPath}`)
        resolve(true)
      } else {
        console.error(`${streamName(streamUrl)}: Failed to capture. Exit code: ${code}`)
        // console.error(`Error output: ${errorOutput}`)
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath)
        }
        resolve(false)
      }
    })
  })
}
function streamName(streamUrl) {
  return streamUrl.split('/').pop()
}
async function captureWithRetry(streamUrl, failedAttempts = 0) {
  const success = await captureFrame(streamUrl)
  
  if (success) {
    return 0 // Reset failed attempts on success
  } else {
    failedAttempts++
    if (failedAttempts <= maxRetries) {
      console.log(`${streamName(streamUrl)}: Immediate retry ${failedAttempts} of ${maxRetries}`)
      return captureWithRetry(streamUrl, failedAttempts)
    } else {
      const nextDelay = getNextCheckTime(failedAttempts - maxRetries)
      console.log(`${streamName(streamUrl)}: Next attempt in ${Math.round(nextDelay / 60000)} minutes`)
      return failedAttempts
    }
  }
}

function startCapture(streamUrl) {
  let failedAttempts = 0

  async function captureAndSchedule() {
    if (!isCapturing) return

    const startTime = Date.now()
    failedAttempts = await captureWithRetry(streamUrl, failedAttempts)
    const endTime = Date.now()
    const elapsedTime = endTime - startTime

    let nextCaptureDelay
    if (failedAttempts > maxRetries) {
      nextCaptureDelay = getNextCheckTime(failedAttempts - maxRetries)
    } else if (isWorkingHours() && isWorkingDay()) {
      nextCaptureDelay = Math.max(0, captureInterval - elapsedTime)
    } else {
      nextCaptureDelay = getNextCheckTime(0)
    }

    setTimeout(captureAndSchedule, nextCaptureDelay)
  }

  captureAndSchedule()
}

function stopCapture() {
  isCapturing = false
  console.log('Time-lapse recording stopped.')
}

// Ensure base output directory exists
ensureDirectoryExists(baseOutputDir)

// Start capture for each stream
streams.forEach(startCapture)

console.log('Time-lapse recording started for all streams. Type "stop" to end the capture process.')

// Set up readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

rl.on('line', (input) => {
  if (input.toLowerCase() === 'stop') {
    stopCapture()
    rl.close()
  }
})

/*
[Unit]
Description=My Node.js Script
After=network.target

[Service]
ExecStart=/usr/bin/node /home/pi/myscript.js
Restart=always
User=pi
Environment=PATH=/usr/bin:/usr/local/bin
Environment=NODE_ENV=production
WorkingDirectory=/home/pi

[Install]
WantedBy=multi-user.target

*/