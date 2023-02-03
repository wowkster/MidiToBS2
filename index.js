import * as fs from 'fs'

import midiParser from 'midi-parser-js'

import { NOTE_FREQUENCIES, NOTE_NAMES } from './notes.js'

// Read in the midi file and parse it
const midi = await new Promise(res =>
    fs.readFile('./Cantina.mid', 'base64', function (err, data) {
        // Parse the obtainer base64 string ...
        const midiArray = midiParser.parse(data)

        res(midiArray)
    })
)

/* Extract Info from Midi File */
const ticksPerBeat = midi.timeDivision

const [melody, bass] = midi.track.map(t => t.event)

const melodyNoteTimes = trackToNoteTimes(melody)
const bassNoteTimes = trackToNoteTimes(bass)

const noteTimes = mergeTracks(melodyNoteTimes, bassNoteTimes)

/* Build the program from the computed data */

let emittedCode = ''

emittedCode += `' {$STAMP BS2}\n`
emittedCode += `' {$PBASIC 2.5}\n`

emittedCode += '\n'

emittedCode += `' ==== Define Speaker Pin ====\n`
emittedCode += `speaker PIN 10\n`

emittedCode += '\n'

emittedCode += `' ==== Note Frequency Constants (rounded to nearest integer) ====\n`

emittedCode += NOTE_NAMES.map((_, i) => i)
    .filter(i => noteTimes.flatMap(noteTime => noteTime.notes).some(note => note === i))
    .map(
        index =>
            `${NOTE_NAMES[index]} CON ${Math.round(NOTE_FREQUENCIES[index])}`.padEnd(18, ' ') +
            `' ${NOTE_NAMES[index].replaceAll('s', '#').replaceAll('m', '-')}`
    )
    .join('\n')

emittedCode += '\n\n'

emittedCode += `' ==== Music Starts Here ====\n`

emittedCode += noteTimes
    .map(noteTime =>
        noteTime.notes?.length
            ? `FREQOUT speaker, ${Math.ceil(deltaTicksToMilliseconds(noteTime.end - noteTime.start))}, ${noteTime.notes
                  .map(note => NOTE_NAMES[note])
                  .join(', ')}`
            : `PAUSE ${Math.ceil(deltaTicksToMilliseconds(noteTime.end - noteTime.start))}`
    )
    .join('\n')

emittedCode += '\n'

/* Print out the generated program */

console.log(emittedCode)

fs.writeFileSync('program.bs2', emittedCode)

/* Helper Functions */

function deltaTicksToMilliseconds(deltaTicks) {
    const microsecondsPerBeat = melody[1].data

    // Ticks to beats and then beats to us
    return ((deltaTicks / ticksPerBeat) * microsecondsPerBeat) / 1000
}

function trackToNoteTimes(track) {
    const endOfTrack = track.pop()
    const musicEvents = track.filter(e => e.type == 8 || e.type == 9)

    // Store the currently active notes at a given point in the loop
    const activeNotes = new Set()

    // Accumulates the value of the delta time throughout the loop
    let deltaTickAcc = 0

    // Stores the highest note at a given starting time
    const highestNotes = []

    let lastDeletion = 0

    /* Loop though the music events in the track and extract all the highest notes at a given point */

    for (const { deltaTime, type, data } of musicEvents) {
        /* If the delta time is > 0 that means all the changes for that time period are set and we can act on them */

        if (deltaTime > 0) {
            const notes = Array.from(activeNotes.values()).sort()
            const highestNote = notes[notes.length - 1] ?? null

            highestNotes.push({
                note: highestNote,
                start: deltaTickAcc,
            })

            deltaTickAcc += deltaTime
        }

        /* Get the current note from the event and set its presence or removal */

        const [note, _velocity] = data

        if (type === 8) {
            activeNotes.delete(note)

            lastDeletion = deltaTickAcc
        } else if (type === 9) {
            activeNotes.add(note)
        }
    }

    /* Remove duplicate notes that are next to each other (we cant add any type of vel so we don't care) */

    for (let i = 0; i < highestNotes.length; i++) {
        while (i < highestNotes.length && highestNotes[i] && highestNotes[i]?.note === highestNotes[i + 1]?.note)
            highestNotes.splice(i + 1, 1)
    }

    /* Convert the primitive array of start times to a full list of the start and end times */

    const noteTimes = []

    for (let i = 0; i < highestNotes.length - 1; i++) {
        noteTimes.push({
            ...highestNotes[i],
            end: highestNotes[i + 1].start,
        })
    }

    noteTimes.push({
        ...highestNotes[highestNotes.length - 1],
        end: lastDeletion,
    })

    return noteTimes
}

function mergeTracks(track1, track2) {
    track1 = track1.filter(noteTime => noteTime.note !== null)
    track2 = track2.filter(noteTime => noteTime.note !== null)

    /* If both arrays are empty, return an empty array */

    if (!track1?.length && !track2?.length) return []

    /* If the first track is empty, return the second track */

    if (!track1.length)
        return track2.map(noteTime => ({
            notes: [noteTime.note],
            start: noteTime.start,
            end: noteTime.end,
        }))

    /* If the second track is empty, return the first track */

    if (!track2.length)
        return track1.map(noteTime => ({
            notes: [noteTime.note],
            start: noteTime.start,
            end: noteTime.end,
        }))

    /* If both tracks are not empty, merge them together */

    const result = []

    let currentTime = 0

    let currentNote1
    let currentNote2

    currentNote1 = track1.shift()
    currentNote2 = track2.shift()

    /* Loop through the notes and find all the 12 edge cases */

    while (track1.length || track2.length || currentNote1.end > currentTime || currentNote2.end > currentTime) {
        const lastTime = currentTime

        // Both notes playing at same time
        if (
            currentNote1.start <= currentTime &&
            currentNote2.start <= currentTime &&
            currentNote1.end > currentTime &&
            currentNote2.end > currentTime
        ) {
            if (currentNote1.end === currentNote2.end) {
                currentTime = currentNote1.end

                result.push({
                    notes: [currentNote1.note, currentNote2.note],
                    start: currentNote1.start,
                    end: currentNote1.end,
                })

                if (track1.length) currentNote1 = track1.shift()
                if (track2.length) currentNote2 = track2.shift()
            } else if (currentNote1.end > currentNote2.end) {
                currentTime = currentNote2.end

                result.push({
                    notes: [currentNote1.note, currentNote2.note],
                    start: currentNote1.start,
                    end: currentNote2.end,
                })

                if (track2.length) currentNote2 = track2.shift()
            } else {
                currentTime = currentNote1.end

                result.push({
                    notes: [currentNote1.note, currentNote2.note],
                    start: currentNote1.start,
                    end: currentNote1.end,
                })

                if (track1.length) currentNote1 = track1.shift()
            }
        }
        // Note 1 playing but not note 2 yet
        else if (
            currentNote1.start <= currentTime &&
            currentNote2.start > currentTime &&
            currentNote1.end > currentTime
        ) {
            // Check which comes first: note 1 end or note 2 start

            if (currentNote1.end <= currentNote2.start) {
                // Note 1 ends before note 2 starts

                result.push({
                    notes: [currentNote1.note],
                    start: currentTime,
                    end: currentNote1.end,
                })

                currentTime = currentNote1.end

                if (track1.length) currentNote1 = track1.shift()
            } else if (currentNote2.start < currentNote1.end) {
                // Note 2 starts before note 1 ends

                result.push({
                    notes: [currentNote1.note],
                    start: currentTime,
                    end: currentNote2.start,
                })

                currentTime = currentNote2.start
            }
        }
        // Note 2 playing but not note 1 yet
        else if (
            currentNote2.start <= currentTime &&
            currentNote1.start > currentTime &&
            currentNote2.end > currentTime
        ) {
            // Check which comes first: note 2 end or note 1 start

            if (currentNote2.end <= currentNote1.start) {
                // Note 2 ends before note 1 starts

                result.push({
                    notes: [currentNote2.note],
                    start: currentTime,
                    end: currentNote2.end,
                })

                currentTime = currentNote2.end

                if (track2.length) currentNote2 = track2.shift()
            } else if (currentNote1.start < currentNote2.end) {
                // Note 1 starts before note 2 ends

                result.push({
                    notes: [currentNote2.note],
                    start: currentTime,
                    end: currentNote1.start,
                })

                currentTime = currentNote1.start
            }
        }
        // Next notes have both not started yet (rest)
        else if (currentNote1.start > currentTime && currentNote2.start > currentTime) {
            // Next note is which ever has lower start time
            const nextStart = Math.min(currentNote1.start, currentNote2.start)

            // Push a rest
            result.push({
                notes: [],
                start: currentTime,
                end: nextStart,
            })

            // Move currentTime up to next note start
            currentTime = nextStart
        }
        // Rest before single last note on track1
        else if (currentNote1.start > currentTime && currentNote2.end <= currentTime) {
            // Push a rest
            result.push({
                notes: [],
                start: currentTime,
                end: currentNote1.start,
            })

            // Move currentTime up to next note start
            currentTime = currentNote1.start
        }
        // Rest before single last note on track2
        else if (currentNote2.start > currentTime && currentNote1.end <= currentTime) {
            // Push a rest
            result.push({
                notes: [],
                start: currentTime,
                end: currentNote2.start,
            })

            // Move currentTime up to next note start
            currentTime = currentNote2.start
        }
        // Only one note playing left (note1)
        else if (currentNote1.start <= currentTime && currentNote2.end <= currentTime) {
            // Push until the end of the note
            result.push({
                notes: [currentNote1.note],
                start: currentTime,
                end: currentNote1.end,
            })

            // Move currentTime to the end of the playing note
            currentTime = currentNote1.end

            if (track1.length) currentNote1 = track1.shift()
        }
        // Only one note playing left (note2)
        else if (currentNote2.start <= currentTime && currentNote2.end <= currentTime) {
            // Push until the end of the note
            result.push({
                notes: [currentNote2.note],
                start: currentTime,
                end: currentNote2.end,
            })

            // Move currentTime to the end of the playing note
            currentTime = currentNote2.end

            if (track2.length) currentNote2 = track12.shift()
        }

        if (currentTime === lastTime) throw 'ASSERT: `currentTime` was not updated in the loop'
    }

    if (currentNote1.end > currentTime || currentNote2.end > currentTime) {
        throw 'ASSERT: Extra note found when none expected'
    }

    return result
}
