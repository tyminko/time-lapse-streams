const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const readline = require('readline')

// List of RTSP stream URLs (only include the working one)
const streams = [
  'rtsp://167.235.64.79:8554/stream1',
  'rtsp://167.235.64.79:8554/stream2',
  'rtsp://167.235.64.79:8554/stream3',
  'rtsp://167.235.64.79:8554/stream4',
  'rtsp://167.235.64.79:8554/stream5',
  'rtsp://167.235.64.79:8554/stream6',
  'rtsp://167.235.64.79:8554/stream7',
  'rtsp://167.235.64.79:8554/stream8',
  'rtsp://167.235.64.79:8554/stream9',
  'rtsp://167.235.64.79:8554/stream10',
  'rtsp://167.235.64.79:8554/stream11',
  'rtsp://167.235.64.79:8554/stream12',
]

// Configuration
const primaryOutputDir = '/media/pi/4A/time-lapse-frames'
const fallbackOutputDir = './time-lapse-frames'
const baseOutputDir = fs.existsSync(primaryOutputDir) ? primaryOutputDir : fallbackOutputDir

const captureInterval = 60000 // Capture a frame every minute (60000 ms) when stream is available
const jpegQuality = 80 // JPEG quality (0-100, higher is better quality)
const outputWidth = 1920 // Output width in pixels (set to -1 or 0 to maintain aspect ratio)
const outputHeight = 1080 // Output height in pixels (set to -1 or 0 to maintain aspect ratio)

// Kharkiv time zone offset (in minutes)
const kharkivOffset = 180 // UTC+3

// Working hours in Kharkiv time
const workingHoursStart = 12 // 12:00
const workingHoursEnd = 19 // 19:00
const morningCheckTime = 10 // 10:00

// Post-working hours check configuration
const postWorkingHoursChecks = 3 // Number of checks after working hours
const postWorkingHoursInterval = 5 * 60000 // 10 minutes between post-working hours checks

// Error handling configuration
const maxRetries = 3 // Maximum number of immediate retries
const retryDelay = 5000 // Delay between retries (5 seconds)

let isCapturing = true
let postWorkingHoursCheckCount = 0 // Counter for post-working hours checks

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

// Helper function to get next check time
function getNextCheckTime() {
  const kharkivTime = getKharkivTime()
  const currentHour = kharkivTime.getHours()
  const currentMinute = kharkivTime.getMinutes()

  if (isWorkingDay()) {
    if (currentHour >= workingHoursEnd) {
      // After working hours
      if (postWorkingHoursCheckCount < postWorkingHoursChecks) {
        postWorkingHoursCheckCount++
        console.log(`Post-working hours check ${postWorkingHoursCheckCount} of ${postWorkingHoursChecks}`)
        return postWorkingHoursInterval
      } else {
        // After post-working hours checks, wait until next morning check
        const nextDay = new Date(kharkivTime)
        nextDay.setDate(nextDay.getDate() + 1)
        nextDay.setHours(morningCheckTime, 0, 0, 0)
        postWorkingHoursCheckCount = 0 // Reset the counter
        return nextDay.getTime() - Date.now()
      }
    } else if (currentHour < morningCheckTime) {
      // Before morning check time
      return (morningCheckTime - currentHour) * 3600000 - currentMinute * 60000
    } else if (currentHour < workingHoursStart) {
      // Between morning check and working hours start
      const timeUntilStart = (workingHoursStart - currentHour) * 60 - currentMinute
      if (timeUntilStart <= 30) {
        return 5 * 60000 // Check every 5 minutes when close to working hours
      } else if (timeUntilStart <= 60) {
        return 15 * 60000 // Check every 15 minutes when within an hour of working hours
      } else {
        return 30 * 60000 // Check every 30 minutes otherwise
      }
    } else {
      // During working hours
      return captureInterval
    }
  } else {
    // Monday
    if (currentHour >= workingHoursEnd) {
      // After working hours on Monday, do post-working hours checks
      if (postWorkingHoursCheckCount < postWorkingHoursChecks) {
        postWorkingHoursCheckCount++
        console.log(`Post-working hours check ${postWorkingHoursCheckCount} of ${postWorkingHoursChecks} (Monday)`)
        return postWorkingHoursInterval
      } else {
        // After post-working hours checks, wait until next morning
        const nextDay = new Date(kharkivTime)
        nextDay.setDate(nextDay.getDate() + 1)
        nextDay.setHours(morningCheckTime, 0, 0, 0)
        postWorkingHoursCheckCount = 0 // Reset the counter
        return nextDay.getTime() - Date.now()
      }
    } else {
      // During the day on Monday
      return 3600000 // Check every hour
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

function streamName(streamUrl) {
  const n = extractStreamNumber(streamUrl)
  const nString = n < 10 ? ` ${n}` : n.toString()
  return `stream ${nString}`
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
  const streamDir = path.join(baseOutputDir, `stream-${streamNumber}`, `${year}-${month}-${day}`)
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
        // Check for specific error conditions
        if (errorOutput.includes("Error opening input file") && 
            errorOutput.includes("Server returned 404 Not Found")) {
          console.error(`${streamName(streamUrl)}: Stream not found (404 error)`)
        } else {
          console.log(`${streamName(streamUrl)}: Capture failed`)
        }
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath)
        }
        resolve(false)
      }
    })
  })
}

async function captureWithRetry(streamUrl, retries = 0) {
  const success = await captureFrame(streamUrl)
  
  if (success) {
    postWorkingHoursCheckCount = 0 // Reset the counter on successful capture
    return true
  } else if (retries < maxRetries) {
    console.log(`${streamName(streamUrl)}: Retry ${retries + 1} of ${maxRetries} in ${retryDelay / 1000} seconds`)
    await new Promise(resolve => setTimeout(resolve, retryDelay))
    return captureWithRetry(streamUrl, retries + 1)
  } else {
    console.log(`${streamName(streamUrl)}: All retries failed`)
    return false
  }
}

function startCapture(streamUrl) {
  async function captureAndSchedule() {
    if (!isCapturing) return

    const success = await captureWithRetry(streamUrl)

    let nextCheckTime
    if (success) {
      // If capture was successful, schedule next capture at regular interval
      nextCheckTime = captureInterval
      console.log(`${streamName(streamUrl)}: Capture successful, next capture in ${nextCheckTime / 1000} seconds`)
    } else {
      // If capture failed, use the smart scheduling
      nextCheckTime = getNextCheckTime()
      console.log(`${streamName(streamUrl)}: Capture failed, next check in ${Math.round(nextCheckTime / 60000)} minutes`)
    }

    setTimeout(captureAndSchedule, nextCheckTime)
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
