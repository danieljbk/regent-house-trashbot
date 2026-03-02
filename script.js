const WORKER_URL = 'https://trashbotapi.kwon.ai'

const onDutyEl = document.getElementById('on-duty')
const trashDayDateEl = document.getElementById('trash-day-date')
const upcomingListEl = document.getElementById('upcoming-list')
const penaltyStatusEl = document.getElementById('penalty-status')
const prevDutyReportEl = document.getElementById('prev-duty-report')
const reportButton = document.getElementById('report-button')
const reportResponseEl = document.getElementById('report-response')
const prevDutyEl = document.getElementById('prev-duty')
const heroLabelEl = document.getElementById('hero-label')
const dateBadgeEl = document.getElementById('date-badge')
const rotationListEl = document.getElementById('rotation-list')
const reportToggle = document.getElementById('report-toggle')
const reportBody = document.getElementById('report-body')
const reportChevron = document.getElementById('report-chevron')
const reportPinInput = document.getElementById('report-pin')

const MAX_UPCOMING_ROWS = 4

// --- DATE HELPERS ---

/**
 * Returns the Tuesday of the current duty week (Mon–Sun).
 * Mon: forward 1 day to Tuesday. Tue–Sat: back to this Tuesday. Sun: back 5 days.
 */
const getThisWeekTuesday = (from) => {
  const d = new Date(from)
  const day = d.getDay()
  const diff = day === 0 ? -5 : 2 - day
  d.setDate(d.getDate() + diff)
  return d
}

const formatDateFull = (date) => {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

const formatDateShort = (date) => {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const deriveUpcoming = (data) => {
  if (Array.isArray(data.upcoming) && data.upcoming.length > 0) {
    return data.upcoming
  }

  const team = Array.isArray(data.team) ? data.team : []
  if (team.length === 0) return []

  const currentIndex = Number.parseInt(data.currentIndex, 10)
  if (Number.isNaN(currentIndex)) return []

  const penaltyBox = data.penaltyBox || {}
  let penaltyWeeks = Number.parseInt(penaltyBox.weeksRemaining, 10)
  if (Number.isNaN(penaltyWeeks) || penaltyWeeks < 0) penaltyWeeks = 0
  const offenderIndex = Number.isInteger(penaltyBox.offenderIndex)
    ? penaltyBox.offenderIndex
    : undefined

  const names = []
  let pointer = currentIndex

  for (let step = 0; step < MAX_UPCOMING_ROWS; step++) {
    if (penaltyWeeks > 0 && offenderIndex !== undefined) {
      const offender = team[offenderIndex]
      if (!offender) break
      names.push(offender.name)
      penaltyWeeks--
      continue
    }

    pointer = (pointer + 1) % team.length
    const person = team[pointer]
    if (!person) break
    names.push(person.name)
  }

  return names
}

// --- REPORT TOGGLE ---

reportToggle.addEventListener('click', () => {
  const isHidden = reportBody.style.display === 'none'
  reportBody.style.display = isHidden ? 'block' : 'none'
  reportChevron.classList.toggle('open', isHidden)
})

// --- FETCH SCHEDULE ---

async function fetchSchedule() {
  // Populate date badge immediately (no API needed)
  const today = new Date()
  dateBadgeEl.textContent =
    'Today is ' +
    today.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    })

  try {
    const response = await fetch(`${WORKER_URL}/schedule`)
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const data = await response.json()

    // After Tuesday (Wed–Sun), shift forward: show next week's person as hero
    const dayOfWeek = today.getDay()
    const pastTuesday = dayOfWeek >= 3 || dayOfWeek === 0

    const allUpcoming = deriveUpcoming(data)
    const thisWeekTue = getThisWeekTuesday(today)

    // Hero label: "Today's duty" on Tuesday, "Next duty" otherwise
    const isTuesday = dayOfWeek === 2
    heroLabelEl.textContent = isTuesday ? "Today's duty" : 'Next duty'

    if (pastTuesday && allUpcoming.length > 0) {
      // Trash day passed — show next person as hero
      onDutyEl.textContent = allUpcoming[0]
      const nextTuesday = new Date(thisWeekTue)
      nextTuesday.setDate(thisWeekTue.getDate() + 7)
      trashDayDateEl.textContent = formatDateFull(nextTuesday)
      prevDutyEl.textContent = data.onDuty
      prevDutyReportEl.textContent = data.onDuty
    } else {
      // Mon/Tue — show current person
      onDutyEl.textContent = data.onDuty
      trashDayDateEl.textContent = formatDateFull(thisWeekTue)
      prevDutyEl.textContent = data.lastWeek
      prevDutyReportEl.textContent = data.lastWeek
    }

    // Upcoming schedule — skip first entry if it's now the hero
    const upcomingStart = pastTuesday ? 1 : 0
    const upcomingNames = allUpcoming.slice(upcomingStart)
    upcomingListEl.innerHTML = ''

    if (upcomingNames.length === 0) {
      const row = document.createElement('tr')
      const cell = document.createElement('td')
      cell.colSpan = 2
      cell.textContent = 'No upcoming rotation data available.'
      row.appendChild(cell)
      upcomingListEl.appendChild(row)
    }

    // Base Tuesday for upcoming dates: offset by 1 week if past Tuesday
    const upcomingBaseTue = pastTuesday
      ? new Date(thisWeekTue.getTime() + 7 * 86400000)
      : thisWeekTue

    upcomingNames.forEach((name, index) => {
      const upcomingTuesday = new Date(upcomingBaseTue)
      upcomingTuesday.setDate(upcomingBaseTue.getDate() + (index + 1) * 7)

      const row = document.createElement('tr')
      const nameCell = document.createElement('td')
      const dateCell = document.createElement('td')

      nameCell.textContent = name
      dateCell.textContent = formatDateFull(upcomingTuesday)

      row.appendChild(nameCell)
      row.appendChild(dateCell)
      upcomingListEl.appendChild(row)
    })

    // Rotation order
    rotationListEl.innerHTML = ''
    const team = data.team || []
    const currentIndex = Number.parseInt(data.currentIndex, 10)

    team.forEach((member, index) => {
      const li = document.createElement('li')
      if (index === currentIndex) {
        li.classList.add('is-current')
      }

      const dot = document.createElement('span')
      dot.className = 'dot'

      const nameSpan = document.createElement('span')
      nameSpan.textContent = member.name

      li.appendChild(dot)
      li.appendChild(nameSpan)
      rotationListEl.appendChild(li)
    })

    // Penalty banner
    const penaltyInfo = data.penaltyInfo
    if (penaltyInfo && penaltyInfo.bannerText) {
      penaltyStatusEl.textContent = penaltyInfo.bannerText
      penaltyStatusEl.style.display = 'block'
    } else if (penaltyInfo && penaltyInfo.isActive) {
      const offenderName = penaltyInfo.offenderName || data.lastWeek
      const remaining = penaltyInfo.weeksRemainingAfterCurrent ?? 0
      const remainWord = remaining === 1 ? 'Tuesday' : 'Tuesdays'
      const message = penaltyInfo.isFinalWeek
        ? `Penalty active: ${offenderName} is serving the final penalty duty. Normal rotation resumes next Tuesday.`
        : `Penalty active: ${offenderName} is on duty ${penaltyInfo.currentWeek} of ${penaltyInfo.totalWeeks}. ${remaining} ${remainWord} remain.`
      penaltyStatusEl.textContent = message
      penaltyStatusEl.style.display = 'block'
    } else if (penaltyInfo && penaltyInfo.startsNextRotation) {
      const offenderName = penaltyInfo.offenderName || data.lastWeek
      const count = penaltyInfo.weeksRemaining
      const word = count === 1 ? 'Tuesday' : 'Tuesdays'
      penaltyStatusEl.textContent = `Penalty recorded: ${offenderName} owes ${count} ${word}. Rotation pauses when their turn arrives.`
      penaltyStatusEl.style.display = 'block'
    } else {
      penaltyStatusEl.textContent = ''
      penaltyStatusEl.style.display = 'none'
    }
  } catch (error) {
    console.error('Failed to fetch schedule:', error)
    onDutyEl.textContent = 'Could not load schedule.'
  }
}

// --- REPORT BUTTON ---

reportButton.addEventListener('click', async () => {
  const pin = reportPinInput.value.trim()
  if (!pin) {
    reportResponseEl.textContent = 'Please enter the PIN.'
    reportResponseEl.className = 'report-response error'
    return
  }

  if (
    !confirm(
      `Report ${prevDutyReportEl.textContent} for missing their duty?`
    )
  )
    return

  try {
    reportButton.disabled = true
    reportResponseEl.textContent = 'Submitting...'
    reportResponseEl.className = 'report-response'

    const response = await fetch(`${WORKER_URL}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })

    const result = await response.json()

    if (!response.ok) {
      reportResponseEl.textContent = result.error || 'Report failed.'
      reportResponseEl.className = 'report-response error'
    } else {
      reportResponseEl.textContent = result.message
      reportResponseEl.className = 'report-response success'
      reportPinInput.value = ''
      fetchSchedule()
    }
  } catch (error) {
    reportResponseEl.textContent = 'Network error. Try again.'
    reportResponseEl.className = 'report-response error'
  } finally {
    reportButton.disabled = false
  }
})

// Initial load
document.addEventListener('DOMContentLoaded', fetchSchedule)
