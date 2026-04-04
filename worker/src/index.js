const PENALTY_LENGTH = 3

export default {
  /**
   * SCHEDULED HANDLER
   * Runs on a cron schedule to advance the rotation.
   */
  async scheduled(event, env, ctx) {
    let rotationDb
    try {
      rotationDb = getRotationDb(env)
    } catch (error) {
      console.error(error.message)
      return
    }

    // 1. Get current state from KV
    const team = await rotationDb.get('TEAM_MEMBERS', 'json')
    if (!team || team.length === 0) {
      console.error('FATAL: Team data is missing or empty.')
      return
    }
    let currentIndex = parseInt((await rotationDb.get('CURRENT_INDEX')) || '0')
    const rawPenaltyBox = await rotationDb.get('PENALTY_BOX', 'json')
    const teamSize = team.length

    // 2. Validate the stored penalty state before using it.
    let penaltyBox = null
    let penaltyOffender
    let penaltyWeeks = 0
    if (rawPenaltyBox) {
      const offenderIndex = Number.isInteger(rawPenaltyBox.offenderIndex)
        ? rawPenaltyBox.offenderIndex
        : undefined
      const weeksRemaining = Number.isInteger(rawPenaltyBox.weeksRemaining)
        ? rawPenaltyBox.weeksRemaining
        : 0
      if (
        offenderIndex !== undefined &&
        offenderIndex >= 0 &&
        offenderIndex < teamSize
      ) {
        penaltyOffender = team[offenderIndex]
        penaltyWeeks = Math.max(0, weeksRemaining)
        if (penaltyWeeks > 0) {
          penaltyBox = { offenderIndex, weeksRemaining: penaltyWeeks }
        }
      } else {
        // Invalid penalty (probably team edited); clean it up so the worker can recover.
        await rotationDb.delete('PENALTY_BOX')
      }
    }

    // 3. Update state for the new rotation cycle *first*
    let activePenalty = null
    if (penaltyBox && penaltyWeeks > 0) {
      const remainingAfterThisWeek = Math.max(0, penaltyWeeks - 1)
      activePenalty = {
        offenderIndex: penaltyBox.offenderIndex,
        offender: penaltyOffender,
        remainingAfterThisWeek,
        weeksServed: PENALTY_LENGTH - penaltyWeeks,
      }

      await rotationDb.put(
        'PENALTY_BOX',
        JSON.stringify({
          offenderIndex: penaltyBox.offenderIndex,
          weeksRemaining: remainingAfterThisWeek,
        })
      )
    } else {
      if (penaltyBox && penaltyWeeks === 0) {
        await rotationDb.delete('PENALTY_BOX')
      }
      currentIndex = (currentIndex + 1) % teamSize
      await rotationDb.put('CURRENT_INDEX', currentIndex.toString())
    }

  },

  /**
   * FETCH HANDLER
   * Responds to requests from the website to provide schedule data.
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    if (url.pathname === '/schedule') {
      try {
        const rotationDb = getRotationDb(env)
        const team = await rotationDb.get('TEAM_MEMBERS', 'json')
        if (!Array.isArray(team) || team.length === 0) {
          throw new Error('Team data is missing or empty.')
        }
        const currentIndex = parseInt(
          (await rotationDb.get('CURRENT_INDEX')) || '0'
        )
        const rawPenaltyBox =
          (await rotationDb.get('PENALTY_BOX', 'json')) || {}
        const teamSize = team.length

        // Base indices assume a normal rotation until we prove a penalty overrides it.
        const baseLastWeekIndex = (currentIndex - 1 + teamSize) % teamSize
        let onDutyName = team[currentIndex].name
        let lastWeekName = team[baseLastWeekIndex].name
        let penaltyInfo = {}

        // Parse any stored penalty information and coerce the values we rely on.
        const offenderIndex = Number.isInteger(rawPenaltyBox.offenderIndex)
          ? rawPenaltyBox.offenderIndex
          : undefined
        const offenderValid =
          offenderIndex !== undefined &&
          offenderIndex >= 0 &&
          offenderIndex < teamSize
        const futureWeeks = Number.isInteger(rawPenaltyBox.weeksRemaining)
          ? Math.max(0, rawPenaltyBox.weeksRemaining)
          : 0

        if (offenderValid) {
          const offender = team[offenderIndex]
          const offenderIsCurrent = offenderIndex === currentIndex
          const totalPenaltyWeeks = PENALTY_LENGTH
          const weeksIncludingCurrent = offenderIsCurrent
            ? Math.min(totalPenaltyWeeks, futureWeeks + 1)
            : futureWeeks

          if (offender && offenderIsCurrent) {
            const weeksServed = Math.max(
              0,
              totalPenaltyWeeks - weeksIncludingCurrent
            )
            const activeWeekNumber = weeksServed + 1
            const weeksAfterThisWeek = Math.max(0, futureWeeks)
            const remainingWord =
              weeksAfterThisWeek === 1 ? 'Tuesday' : 'Tuesdays'
            const isFinalWeek = weeksAfterThisWeek === 0
            const activeBanner = isFinalWeek
              ? `PENALTY ACTIVE: ${offender.name} is serving the final penalty duty (${totalPenaltyWeeks}/${totalPenaltyWeeks}). Normal rotation resumes next Tuesday.`
              : `PENALTY ACTIVE: ${offender.name} is on duty ${activeWeekNumber} of ${totalPenaltyWeeks}. ${weeksAfterThisWeek} ${remainingWord} remain.`

            penaltyInfo = {
              offenderName: offender.name,
              weeksRemaining: weeksIncludingCurrent,
              rawWeeksRemaining: futureWeeks,
              weeksServed,
              currentWeek: activeWeekNumber,
              weekString: weeksIncludingCurrent === 1 ? 'Tuesday' : 'Tuesdays',
              weeksRemainingAfterCurrent: weeksAfterThisWeek,
              totalWeeks: totalPenaltyWeeks,
              isActive: true,
              startsNextRotation: false,
              isFinalWeek,
              bannerText: activeBanner,
            }

            onDutyName = offender.name
            lastWeekName = offender.name
          } else if (offender && futureWeeks > 0) {
            const dutyString = futureWeeks === 1 ? 'Tuesday' : 'Tuesdays'
            penaltyInfo = {
              offenderName: offender.name,
              weeksRemaining: futureWeeks,
              rawWeeksRemaining: futureWeeks,
              weeksServed: 0,
              currentWeek: 0,
              weekString: dutyString,
              weeksRemainingAfterCurrent: futureWeeks,
              totalWeeks: totalPenaltyWeeks,
              isActive: false,
              startsNextRotation: true,
              isFinalWeek: false,
              bannerText: `Penalty recorded: ${offender.name} owes ${futureWeeks} ${dutyString}. The rotation will pause when their turn arrives.`,
            }

            lastWeekName = offender.name
          }
        }

        const responseData = {
          onDuty: onDutyName,
          lastWeek: lastWeekName,
          team: team,
          currentIndex: currentIndex,
          penaltyBox: rawPenaltyBox,
          penaltyInfo: penaltyInfo,
        }

        return new Response(JSON.stringify(responseData), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      } catch (error) {
        console.error('Failed to load schedule:', error.message)
        return new Response(
          JSON.stringify({
            error: 'Server configuration error. Please try again later.',
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }
    }

    if (url.pathname === '/report' && request.method === 'POST') {
      // --- PIN VALIDATION ---
      let body = {}
      try {
        body = await request.json()
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'Invalid request body.' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      if (!validatePin(body, env)) {
        return new Response(
          JSON.stringify({ error: 'Incorrect PIN.' }),
          {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      const submittedOffenderIndex = typeof body.offenderIndex === 'number'
        ? body.offenderIndex
        : undefined

      let rotationDb
      try {
        rotationDb = getRotationDb(env)
      } catch (error) {
        console.error(error.message)
        return new Response(
          JSON.stringify({
            error: 'Server configuration error. Please try again later.',
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }
      const teamData = await rotationDb.get('TEAM_MEMBERS', 'json')
      if (!Array.isArray(teamData) || teamData.length === 0) {
        return new Response(
          JSON.stringify({
            error: 'Team data is missing. Penalty cannot be recorded.',
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }
      const teamSize = teamData.length

      // Validate the offender index submitted by the frontend.
      if (
        submittedOffenderIndex === undefined ||
        !Number.isInteger(submittedOffenderIndex) ||
        submittedOffenderIndex < 0 ||
        submittedOffenderIndex >= teamSize
      ) {
        return new Response(
          JSON.stringify({ error: 'Invalid offender index.' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      const offenderIndex = submittedOffenderIndex

      // Check for an existing active penalty.
      const existingPenalty =
        (await rotationDb.get('PENALTY_BOX', 'json')) || {}
      const existingFutureWeeks = Number.isInteger(
        existingPenalty.weeksRemaining
      )
        ? Math.max(0, existingPenalty.weeksRemaining)
        : 0
      const hasActivePenalty =
        Number.isInteger(existingPenalty.offenderIndex) &&
        existingFutureWeeks > 0

      // If a penalty is active for a different person, reject the report.
      if (hasActivePenalty && existingPenalty.offenderIndex !== offenderIndex) {
        const existingOffender = teamData[existingPenalty.offenderIndex]
        return new Response(
          JSON.stringify({
            error: `A penalty is already active for ${existingOffender?.name || 'another person'}. Clear it first before filing a new report.`,
          }),
          {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      // If the same person already has the maximum penalty queued, ignore the report.
      if (
        hasActivePenalty &&
        existingPenalty.offenderIndex === offenderIndex &&
        existingFutureWeeks >= PENALTY_LENGTH - 1
      ) {
        const offender = teamData[offenderIndex]
        console.info(
          `Penalty report ignored: ${offender.name} already has ${existingFutureWeeks} future weeks queued.`
        )
        const responseData = {
          message: `${offender.name} already has a penalty in progress. No changes recorded.`,
        }
        return new Response(JSON.stringify(responseData), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const penalty = {
        offenderIndex: offenderIndex,
        weeksRemaining: Math.max(0, PENALTY_LENGTH - 1),
      }
      await rotationDb.put('PENALTY_BOX', JSON.stringify(penalty))
      await rotationDb.put('CURRENT_INDEX', offenderIndex.toString())

      const offender = teamData[offenderIndex]
      if (offender && offender.name) {
        console.info(
          `Penalty activated for ${offender.name}. Future penalty weeks queued: ${penalty.weeksRemaining}`
        )
      }

      const responseData = {
        message:
          'Penalty has been recorded. The offender is now on duty for the next 3 Tuesdays.',
      }

      return new Response(JSON.stringify(responseData), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- ADMIN ENDPOINTS ---

    if (url.pathname === '/admin/state' && request.method === 'GET') {
      const pin = url.searchParams.get('pin') || ''
      if (!env.REPORT_PIN || pin.trim() !== env.REPORT_PIN) {
        return new Response(
          JSON.stringify({ error: 'Incorrect PIN.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      try {
        const rotationDb = getRotationDb(env)
        const team = await rotationDb.get('TEAM_MEMBERS', 'json')
        const currentIndex = parseInt((await rotationDb.get('CURRENT_INDEX')) || '0')
        const penaltyBox = (await rotationDb.get('PENALTY_BOX', 'json')) || null

        return new Response(
          JSON.stringify({ team, currentIndex, penaltyBox }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch (error) {
        console.error('Admin state read failed:', error.message)
        return new Response(
          JSON.stringify({ error: 'Failed to read state.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    if (url.pathname === '/admin/state' && request.method === 'PUT') {
      let body = {}
      try {
        body = await request.json()
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'Invalid request body.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!validatePin(body, env)) {
        return new Response(
          JSON.stringify({ error: 'Incorrect PIN.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      try {
        const rotationDb = getRotationDb(env)
        const updated = []

        if (body.team !== undefined) {
          if (!Array.isArray(body.team) || body.team.length === 0) {
            return new Response(
              JSON.stringify({ error: 'team must be a non-empty array.' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          for (const member of body.team) {
            if (!member || typeof member.name !== 'string' || !member.name.trim()) {
              return new Response(
                JSON.stringify({ error: 'Each team member must have a non-empty "name" string.' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              )
            }
          }
          await rotationDb.put('TEAM_MEMBERS', JSON.stringify(body.team))
          updated.push('team')
        }

        if (body.currentIndex !== undefined) {
          const idx = Number(body.currentIndex)
          if (!Number.isInteger(idx) || idx < 0) {
            return new Response(
              JSON.stringify({ error: 'currentIndex must be a non-negative integer.' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          await rotationDb.put('CURRENT_INDEX', idx.toString())
          updated.push('currentIndex')
        }

        if (body.penaltyBox !== undefined) {
          if (body.penaltyBox === null) {
            await rotationDb.delete('PENALTY_BOX')
            updated.push('penaltyBox (cleared)')
          } else {
            const pb = body.penaltyBox
            if (
              !Number.isInteger(pb.offenderIndex) ||
              pb.offenderIndex < 0 ||
              !Number.isInteger(pb.weeksRemaining) ||
              pb.weeksRemaining < 0
            ) {
              return new Response(
                JSON.stringify({ error: 'penaltyBox must have valid offenderIndex and weeksRemaining.' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              )
            }
            await rotationDb.put('PENALTY_BOX', JSON.stringify(pb))
            updated.push('penaltyBox')
          }
        }

        return new Response(
          JSON.stringify({ message: `Updated: ${updated.join(', ')}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch (error) {
        console.error('Admin state update failed:', error.message)
        return new Response(
          JSON.stringify({ error: 'Failed to update state.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    if (url.pathname === '/admin/penalty' && request.method === 'DELETE') {
      let body = {}
      try {
        body = await request.json()
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'Invalid request body.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!validatePin(body, env)) {
        return new Response(
          JSON.stringify({ error: 'Incorrect PIN.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      try {
        const rotationDb = getRotationDb(env)
        await rotationDb.delete('PENALTY_BOX')
        return new Response(
          JSON.stringify({ message: 'Penalty box cleared.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch (error) {
        console.error('Admin penalty clear failed:', error.message)
        return new Response(
          JSON.stringify({ error: 'Failed to clear penalty.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders })
  },
}

// --- HELPER FUNCTIONS ---

function validatePin(body, env) {
  const pin = typeof body.pin === 'string' ? body.pin.trim() : ''
  return env.REPORT_PIN && pin === env.REPORT_PIN
}

function getRotationDb(env) {
  const kv = env?.ROTATION_DB
  if (!kv || typeof kv.get !== 'function') {
    throw new Error('ROTATION_DB binding is not configured.')
  }
  return kv
}

