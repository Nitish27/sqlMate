# sqlMate Connection Session (35-45 minutes)

Participant ID: ______  Build: ______  Date: ______  Moderator: ______

**Before arrival:** Start and verify the [disposable fixture](README.md). Use a separate OS profile, fake credentials, and an empty sqlMate workspace. Get permission before screen/audio recording; pause recording for any real secrets. Do not use a real production database.

**Opening (3 min):** "We are testing sqlMate, not you. Please say what you expect and what confuses you. I will not guide you through the interface. You may stop at any time." Ask: "What database client do you normally use?"

**Tasks (25-30 min):** Read each goal aloud. Do not name controls or demonstrate clicks. If stuck for two minutes, ask "What would you try next?" and mark the task *assisted*. Give only the connection card fields needed for that task.

1. **Recover from failure:** "Connect to `sqlmate_lab` using this card." Give host `127.0.0.1`, port `15432`, user `sqlmate_tester`, and the *wrong* password `incorrect-demo-password`. After they explain the error, hand them the corrected password `sqlmate-demo-only`. Observe whether they test again and understand whether the connection was saved.
2. **Return after restart:** "Save this connection so you can return to `session_items` after restarting sqlMate without typing the password again." Observe the choice to remember credentials, any keychain prompt, and whether they expect to type a password again.
3. **Understand identity and safety:** "Tell me which database you are using and what would happen if you changed a row. Rename the connection, then change its protection setting." Ask what they expect before they act.
4. **Simulated production:** "Add a second connection to `sqlmate_prod_sim` and mark its environment `production`. Change the status of item 1 to `reviewed`, but stop if you are unsure which database will change." The host, port, user, and correct password are the same. Observe whether `Alert` and the confirmation communicate the target clearly.
5. **Protect pending work:** "With a table tab open or a row edit pending, change the first connection's database target to `sqlmate_prod_sim`." Observe whether the warning is understood. Do not instruct them to discard work.
6. **Leave safely:** "Return to the first connection, then disconnect the one you no longer need." Observe whether they can distinguish switching from disconnecting.

**Record for each task:** outcome (*unassisted / assisted / failed*), approximate time, first hesitation, expected result, actual result, exact quote, and any bug reproduction. Keep the note-taker silent. After tasks, ask: "Where did you feel least confident?" and "What would you change first?"

**After the participant leaves (5 min):** Mark safety or credential misunderstandings and core task blockers **high**, recoverable friction **medium**, and cosmetic issues **low**. Group repeated observations across participants; distinguish app bugs from confusing behavior. Reset the fixture before the next participant.
