# Human decision theory behind "System 1 / System 2" and model routing

Raw research notes, 2026-11-28. Scope: the human decision-research side only. Nothing here is evidence about language models. Every "transfers to agents" item is an analogy, graded for strength, with the place it breaks.

Reading conventions. "Full text" means I extracted and read the whole document. "Abstract" or "summary" means less. Quotes are short phrases only. Page refs are journal pages where I could tell; "PDF p." means page of the file I read. I read PDFs by downloading and running pdftotext, so page numbers for some are approximate.

---

## 0. Headline findings (read this first)

1. "System 1 / System 2" is a label from the individual-differences literature (Stanovich & West 2000), later adopted by Kahneman. It is a convenient cluster of correlated features, not a settled architecture. Its own best-known defenders (Evans & Stanovich 2013) say they now prefer to avoid the "System" wording, and that speed is a correlate, not a defining feature.
2. The defining feature of Type 2 in Evans & Stanovich is working-memory-loaded hypothetical thinking ("cognitive decoupling"), not "slow". The "fast = cheap = error-prone, slow = accurate" mapping is exactly what Evans (2012) lists as a fallacy of the "received view". ML papers that equate System 1 with a small/fast model and System 2 with a reasoning model inherit that fallacy before they even reach the model question.
3. Kahneman himself, with Klein, says the quality of a fast judgment depends on the environment (is it regular?) and the judge's learning history, not on the speed of the process. This is the most transferable idea, and also the one most easily overclaimed (see section B1).
4. Simon (satisficing, aspiration levels, stop rules) and Gigerenzer (ecological rationality, less-is-more, bias-variance) are about search cost and fit to environment. They are closer to routing/cascade design than Kahneman's dual-process picture is. Note that Kahneman's heuristics-and-biases tradition and Gigerenzer's tradition disagree sharply about whether heuristics are mostly errors or mostly adaptive tools.
5. Boyd's "Destruction and Creation" (1976) does NOT contain the OODA loop. The OODA diagram comes from his later briefings. Check any claim in the textbook that cites D&C for OODA.
6. The pre-mortem has little direct outcome evidence in what I read. Wikipedia says so explicitly; Kahneman & Klein endorse it as a promising semi-formal method, not a proven one.

---

## A. Sources, one by one

### A1. Bounded rationality, Stanford Encyclopedia of Philosophy (list item 1)
- Citation: "Bounded Rationality", Stanford Encyclopedia of Philosophy. First published 30 Nov 2018; substantive revision 13 Dec 2024. (Author name not shown in the text I received; I did not verify it.)
- URL read: https://plato.stanford.edu/entries/bounded-rationality/
- Type: secondary/reference, but authoritative survey. Read: first ~100,000 of ~198,000 characters via summarizing fetch (not verbatim full text). Second half (incl. most of section 5.2 on Gigerenzer vs Kahneman) NOT read.
- Claims, by section:
  - Intro and section 2: Simon replaced "global rationality of economic man" with behaviour fit to limited information and computation; section 2 introduces procedural rationality (weighing decision costs against resources).
  - 2.2: satisficing = accept first option meeting a predefined aspiration level; quote: people "satisfice because they have not the wits to maximize". Selten's aspiration adaptation extends to multiple goals.
  - 2.1: operating a decision rule is itself costly (Good, Simon); Tversky: rules that violate transitivity can win once evaluation cost counts.
  - 3 (intro, 3.1): rationality is judged relative to the environment; the line between "mind limits" and "environment structure" is drawn differently across fields.
  - 3.2-3.3: Brunswik lens model; rational analysis.
  - 3.5, 4.3: bias-variance trade-off; simple heuristics (tallying, take-the-best) can beat regression out of sample, especially with small samples ("less-is-more"). The entry notes that the standard decomposition is for squared loss and behaves differently for 0-1 loss.
  - 5, 5.1: the core dispute between Kahneman-Tversky and Gigerenzer is the normative standard used to call something an error (taxi-cab/base-rate example).
- Use: best single pointer for the Simon-to-Gigerenzer thread; cite for "the norm you grade against is itself contested".

### A2. openstrategising.com blog on Simon (item 2)
- URL read: https://openstrategising.com/blog/herbert-simon-bounded-rationality-and-attention
- Secondary (blog by Pontus Wadstrom, strategy advisor). Read via summary fetch.
- Content: restates satisficing; Simon's "wealth of information creates a poverty of attention" line; applies it to digital distraction. Nothing beyond Simon. Use only for the attention-scarcity quote, and verify against Simon (1971) before citing; I did not read the primary.

### A3. The Decision Lab, "Bounded rationality" (item 3)
- URL read: https://thedecisionlab.com/biases/bounded-rationality
- Secondary. Read via summary fetch.
- Content: bounded rationality introduced 1955 (page's date); filed under "biases". Caution: it blends Simon's bounded rationality with the heuristics-and-biases error catalogue, which are different research programs. It also adds an ethics claim that is not Simon's. Do not cite for anything about Simon.

### A4. Barros, "Herbert A. Simon and the concept of rationality: boundaries and procedures" (SciELO, item 4)
- Citation: Gustavo Barros (2010), Brazilian Journal of Political Economy 30(3).
- URL read: https://www.scielo.br/j/rep/a/CWfwPPVWKvLrndfxR9vYFHL/?lang=en
- Secondary scholarly article. Read via summary fetch of the page (not verified as full text).
- Claims: bounded rationality is defined as the negation of global rationality and depends on it; procedural rationality better states Simon's positive view; satisficing and search are complementary because satisficing is the search stopping rule; satisficing ideas (mid-1950s) predate the labels (bounded 1957, procedural 1976). Quote of Simon via Barros: "a theory of bounded rationality is necessarily a theory of procedural rationality" (Simon 1997). Barros does not discuss aspiration levels.
- Use: helps the textbook avoid treating "bounded rationality" as a theory in itself; the procedural side (how to search and when to stop) is what routing borrows.

### A5. Simon, "Satisficing" (CMU archive, item 5)
- Citation: Herbert A. Simon, "Satisficing", in D. Greenwald (ed.), The McGraw-Hill Encyclopedia of Economics (McGraw-Hill; the file's date field is garbled, c. 1994), about pp. 881-886. Reprint-permission note says it supplements a different Palgrave entry.
- URL read: http://iiif.library.cmu.edu/file/Simon_box00070_fld05370_bdl0001_doc0001/Simon_box00070_fld05370_bdl0001_doc0001.pdf (6 pages).
- PRIMARY. Read: full text (OCR text layer).
- Claims:
  - Satisficing = "attain or accept a satisfactory solution", one that meets the situation's needs and the decision maker's aspirations; contrast with optimizing. Satisficing can find solutions where the optimum "cannot be discovered".
  - Needle-in-haystack: time to find the sharpest needle grows with haystack size; time to find one "sharp enough to sew with" depends on needle density, not size. (Main section "Computational Costs".)
  - Satisficing criteria "provide a stop rule to terminate search"; accept as soon as a satisfactory alternative appears.
  - Aspiration levels ("Setting Aspiration Levels"): search ends when the best found so far meets all the constraints; aspirations are shaped by past experience and by comparison with others; adjust up when met easily, down when missed.
  - Against the objection that satisficing is just optimal search with search costs priced in: Simon says that conversion complicates the problem "often to the point of infeasibility", needs estimates only available for routine, repeated choices, and ignores the design of new alternatives. He also treats pseudo-optimizing (solving a simplified model exactly) as only one form of satisficing.
- Use: the cleanest primary statement for the cascade-stopping-rule analogy (see B2).

### A6. ResearchGate, "Herbert A Simon and Bounded Rationality" (item 6)
- URL tried: https://www.researchgate.net/publication/394541366_Herbert_A_Simon_and_Bounded_Rationality
- NOT READ. HTTP 403. Nothing recorded from it.

### A7-A9. Tversky & Kahneman 1974 (items 7-9)
- Citation: Amos Tversky and Daniel Kahneman (1974), "Judgment under Uncertainty: Heuristics and Biases", Science 185(4157), 1124-1131 (27 Sep 1974).
- URLs: item 7 https://pubmed.ncbi.nlm.nih.gov/17835457/ (NOT READ; PubMed returned a cookie wall). Item 8 Semantic Scholar (not fetched). Item 9 https://multiplenatures.com/research/rs-0008/ (not fetched; secondary).
- What I actually read: a JSTOR-stamped full-text PDF at https://www.socsci.uci.edu/~bskyrms/bio/readings/tversky_k_heuristics_biases.pdf. PRIMARY, full text (OCR; two-column layout is scrambled but readable).
- Claims: people reduce probability assessment to simpler operations via three heuristics: representativeness, availability, adjustment and anchoring. Quote: "in general, these heuristics are quite useful, but sometimes they lead to severe and systematic errors". Lengthy examples (Steve the librarian, consonants in word position, flight instructor praise/criticism and regression to the mean).
- Note for the textbook: the 1974 paper does not use the words "System 1" or "System 2". The paper's own framing is that the heuristics are economical and usually useful. The popular reading as "intuition = error" is stronger than the paper.

### A10/A14/A17/A19. Kahneman & Klein 2009 (items 10, 14, 17, 19)
- Citation: Daniel Kahneman and Gary Klein (2009), "Conditions for Intuitive Expertise: A Failure to Disagree", American Psychologist 64(6), 515-526. DOI 10.1037/a0016755.
- URL read: https://gwern.net/doc/psychology/cognitive-bias/illusion-of-depth/2009-kahneman.pdf (binary PDF, extracted with pdftotext). Item 14 (PubMed) not fetched. Item 17 (managementcraft.co) read via summary fetch; it is secondary and adds its own "when it matters" application section that is not in the paper.
- PRIMARY. Read: full text, all 12 PDF pages.
- Central claims:
  - Abstract: the quality of an intuitive judgment depends on "the predictability of the environment" and the individual's "opportunity to learn the regularities"; "subjective experience is not a reliable indicator of judgment accuracy."
  - Two necessary conditions for skilled intuition (PDF p. 5-6; summary bullets p. 10): (1) a high-validity environment, meaning stable relationships between identifiable cues and outcomes; (2) adequate opportunity to learn those cues through prolonged practice with feedback that is rapid and unequivocal.
  - Validity is not the same as certainty: poker and warfare are high-validity yet uncertain (p. 6, p. 10). Long-term stock and political forecasting are described as zero-validity (p. 10; Tetlock discussion p. 6).
  - Intuition = recognition, endorsing Simon's definition ("nothing more and nothing less than recognition", Simon 1992 p. 155, quoted on PDF p. 5).
  - Trust the fireground commander and the nurse more than the stock trader (p. 6). Shanteau (1992) list: experts do well in livestock judging, chess, test piloting, etc.; badly among stockbrokers, clinical psychologists, admissions officers, personnel selectors (p. 8).
  - Confidence: "high subjective confidence is not a good indication of validity" (p. 8); professionals in delayed, sparse, ambiguous feedback settings are prone to overconfidence (p. 9). Checking an intuition is "an effortful operation of System 2" that people often skip (p. 8).
  - They disagree on attitude toward formal methods but agree on semi-formal strategies; the pre-mortem is the named example (p. 10 area), which fits both heuristics-and-biases (overconfidence) and NDM (uses expert knowledge). They agree algorithms often beat clinical judgment in low-validity settings (Meehl; Grove et al. 2000 meta-analysis, 136 studies, p. 9).
  - Footnote 2 (PDF p. 5): notes the System 1/2 contrast has its own literature, cites Evans (2007) that System 2 can also satisfice without considering alternatives. This undermines "System 2 = careful, System 1 = sloppy".
  - Recognition-primed decision (RPD) model: fireground commanders don't compare options; they generate one plausible action, mentally simulate, and move to the next if it fails (PDF p. 2).
- Item 17 verdict: secondary; its "two-condition test" is consistent with the paper but its application section is the site author's extension.

### A11-A13. Ecological rationality / fast-and-frugal heuristics (items 11-13)
- Citation: Shenghua Luan, Jochen Reb, Gerd Gigerenzer (2019), "Ecological Rationality: Fast-and-Frugal Heuristics for Managerial Decision Making under Uncertainty", Academy of Management Journal 62(6), 1735-1759. DOI 10.5465/amj.2018.0172.
- URL read: https://pure.mpg.de/rest/items/item_3172441_6/component/file_3184539/content (binary PDF, extracted). PRIMARY. Read: abstract plus targeted passages of the full text (I did not read all 25 pages end to end).
- Item 12 (SMU Institutional Knowledge repository) fetch returned empty; not read. Item 13 (behavioraleconomics.com mini-encyclopedia) fetch returned only a title; not read.
- Claims:
  - Heuristics are often considered inferior to "rational" strategies; the authors argue that under the uncertainty typical of managerial decisions, fast-and-frugal heuristics can do better.
  - Study 1: with data on 236 airline job applicants, a heuristic called D-inference (compare two candidates, search fewer than half the cues) predicted better than logistic regression. Study 2: 1,728 simulated environments to map when the heuristic wins. Study 3: participants adapted strategy to task, more so with experience.
  - Bias-variance (section on decomposition, c. p. 1737-38): prediction error = bias + variance + noise; under uncertainty a model "cannot easily have both small bias and small variance"; simple models accept bias to cut variance, which matters most when learning samples are small. Predictability of job performance is capped near 30% of variance (Schmidt & Hunter), cited as why the setting is uncertain.
  - Less-is-more: more information/complexity does not always help; the paper notes a heuristic's performance depends on environment structure (a footnote notes that in linear environments with enough learning data, the linear model wins as expected).
  - Ecological rationality is evaluated "by its success in an uncertain world", with both a prescriptive and a descriptive side.
- Caution: the result is for a specific two-alternative choice task with a small number of cues and a modest dataset. It is not a general theorem that cheaper beats richer.

### A15. McKinsey, "Strategic decisions: When can you trust your gut?" (item 15)
- Citation: Olivier Sibony and Dan Lovallo interview Daniel Kahneman and Gary Klein, McKinsey Quarterly, March 2010. https://www.mckinsey.com/capabilities/strategy-and-corporate-finance/our-insights/strategic-decisions-when-can-you-trust-your-gut
- Read 2026-11-28: full text of the owner-supplied reprint (PDF text extraction, 9 pages numbered 2-10; page refs below are the reprint's printed numbers). Earlier fetches of the web page had timed out. Primary source for what Klein and Kahneman say, as speakers; an interview, so no method or data.
- Central claims:
  - Klein (p. 3): if "trust" means act on a gut feeling and stop worrying, "we say you should never trust your gut"; treat it as a data point and evaluate it consciously. Kahneman (pp. 3-4): overconfidence is "primarily determined by the quality and coherence of the story that you can construct, not by its validity".
  - Same two conditions as the 2009 paper (p. 4, Klein): a predictable structure (low validity means "no basis for intuition", stock pickers as the example) and a chance to get feedback. Klein adds that most corporate decisions "aren't going to meet the test of high validity" but sit "way above" the low-validity cases.
  - Disagreement (pp. 4-5): Kahneman is wary of experts' intuition unless they have dealt with that kind of problem a lot, and says experts "don't know exactly where the boundaries of their expertise are".
  - Pre-mortem as Klein describes it (p. 7): "a sneaky way to get people to do contrarian, devil's advocate thinking without encountering resistance"; before a project starts, say it "has failed; it's a fiasco" and have everyone "take two minutes and write down all the reasons". The mechanism he gives is social: the dynamic shifts "from trying to avoid anything that might disrupt harmony to trying to surface potential problems". Kahneman (p. 7): "a great idea", "very easy to do"; "My guess is" a plan is tweaked and not abandoned; "low-cost, high-payoff". That is an opinion and no evidence of outcomes. Kahneman (p. 10): "People just love the premortem."
  - Checklists (pp. 7-8): Kahneman likes them where validity is low and says they should be about process; Klein: "The checklist tells you the 'then' but you need expertise to determine the 'if'". Relevant to B8: a checklist item must be checkable.
  - Independence (p. 8): "Fragmenting problems and keeping judgments independent helps decorrelate errors of judgment"; the coins-in-a-jar example shows averaged independent estimates gain accuracy and conformity ruins it. Human groups only; it supports, as an analogy, a critic in a separate context.
  - Remaining disagreement (p. 9): Klein worries error-reduction techniques "can get in the way of gaining insights"; Kahneman would postpone intuition.
- Check against Kahneman & Klein 2009 (A10): the conditions, the confidence warning and the pre-mortem description match. The interview adds Klein's own account of the pre-mortem and the "most corporate decisions" remark, which the 2009 paper does not state in those words.

### A16. Klein, "Conversations with Kahneman" (Psychology Today, item 16)
- Citation: Gary Klein, blog post, Psychology Today, "Seeing What Others Don't", updated 18 Apr 2024 after Kahneman's death (27 Mar 2024).
- URL read: https://www.psychologytoday.com/us/blog/seeing-what-others-dont/202404/conversations-with-kahneman
- Secondary/memoir (by one participant). Read via summary fetch.
- Claims: Klein thinks "biases" is often misused, and calls the heuristics "positive heuristics" he feels the other camp underweights; Kahneman was more interested in expert errors, Klein in expert insight; Kahneman pushed the subtitle "a failure to disagree" and Klein says they disagreed constantly; they treat their work as adversarial collaboration. Agreed criteria: regular environment plus practice with accurate timely feedback.
- Use: for tone and for "this is not a consensus; it is a negotiated boundary".

### A18. Kahneman publications page, Princeton (item 18)
- URL: https://kahneman.scholar.princeton.edu/publications. NOT READ (HTTP 403). The search result did list a PDF of Kahneman 2003 at https://kahneman.scholar.princeton.edu/document/8 but curl returned HTML, not the paper.

### A20-A23. Munger, "The Psychology of Human Misjudgment" (items 20-23)
- Citation: Charles T. Munger, "The Psychology of Human Misjudgment", transcript as expanded for Poor Charlie's Almanack (revised 2005 per the page). The year of the original talk is not stated in the text I read (commonly dated 1995; unverified here).
- URL read: https://fs.blog/great-talks/psychology-human-misjudgment/. PRIMARY text (published with permission). Read: the full page text was fetched with curl (153k characters) and searched; I read the list of 25 tendencies and the passages on checklists, availability, doubt-avoidance, inconsistency-avoidance, but not every section.
- Claims:
  - A list of 25 "tendencies" (reward and punishment superresponse; doubt-avoidance; inconsistency-avoidance; social proof; availability-misweighing; overoptimism; authority-misinfluence; and "lollapalooza", the combination of several acting together).
  - Doubt-Avoidance: mind removes doubt quickly by deciding; triggered by "puzzlement" plus "stress" (the page ties Social-Proof and Stress-Influence to it).
  - Availability-Misweighing: the brain "easily drifts into working with what's easily available". Antidotes: "procedures, including use of checklists, which are almost always helpful"; emphasize disconfirming evidence (Darwin); hire skeptical articulate people to argue against you.
  - Also: a thinking person should "assemble his skills into a checklist that he routinely uses"; latticework of models.
- Items 21-23 (businesssummary.com, sloww.co, ricklindquist.com): secondary summaries, not fetched. Item 24 (Goodreads series page for Parrish's Great Mental Models): catalog metadata only (vol. 1 2018, vol. 2 2019, vols 3-4 other authors); no substantive content; not usable as a source for ideas. Parrish's books themselves not read.
- Caution: Munger's list is a practitioner's synthesis. It is not an experimentally validated taxonomy; many entries overlap with the heuristics-and-biases literature but the list as a whole has no test of completeness or independence. Treat as an organizing device, not a finding.

### A25-A29. Boyd and OODA (items 25-29)
- Citation: John R. Boyd, "Destruction and Creation", 3 September 1976 (an unpublished paper; also circulated with a 23 Mar 1976 date in the bibliography self-reference).
- URL read: https://cdn.mises.org/destruction_and_creation_by_john_r_boyd.pdf. PRIMARY. Read: full text (about 8 pages).
- Claims: we build mental concepts of the world; because of Godel (consistency needs a system outside), Heisenberg (observer intrudes) and the second law (a closed system's disorder rises), any fixed concept drifts out of match with reality. Remedy is cycling: "destructive deduction" (take concepts apart into particulars) then "creative induction" (synthesize a new pattern), driven by the goal of improving the "capacity for independent action". Abstract: the activity is "dialectic" and lets us "shape and be shaped by a changing environment".
- IMPORTANT: a word search finds no "OODA" and no "orientation" in the paper. The OODA loop (Observe-Orient-Decide-Act, with orientation central) comes from later briefings.
- Item 26 https://www.colonelboyd.com/boydswork: lists works, including Patterns of Conflict (Part I) and Organic Design for Command and Control (Part II); says nothing about OODA. Item 27 https://www.coljohnboyd.com/: describes OODA as his best-known concept and says the full diagram shows "the central importance of orientation"; says he never published a book and developed ideas through briefings. Item 28 (kwharrison13.com notes): secondary; confirms D&C is dated 3 Sep 1976, does not attribute OODA to it. Item 29 is Scribd and was skipped as instructed.
- Not read: the OODA briefings themselves (the "Organic Design" or "Patterns of Conflict" slides, or the later "Discourse on Winning and Losing"). Everything I say about orientation below rests on the two Boyd-archive summaries, not on the primary slides. Flag as needing a primary check before the textbook states the OODA structure in detail.

### A30-A36. Snowden & Boone 2007, Cynefin (items 30-36)
- Citation: David J. Snowden and Mary E. Boone (2007), "A Leader's Framework for Decision Making", Harvard Business Review 85(11), Nov 2007 (reprint R0711C).
- URL read: https://www.systemswisdom.com/sites/default/files/Snowdon-and-Boone-A-Leader's-Framework-for-Decision-Making_0.pdf (10 pages). PRIMARY (HBR reprint copy). Read: full text via extraction; key passages quoted below.
- Item 31 (PubMed) not fetched. Item 32 (maryboone.com): read; it is a blurb linking to HBR (paid $6.95), not full text. Item 33 (CMPA paraphrase PDF): read; a one-page table paraphrase, adds nothing. Item 34 (toolshero) not fetched, secondary. Item 35/36 (harvardbusiness.org insight page) not fetched.
- Claims:
  - Five contexts defined by the cause-and-effect relationship: simple, complicated, complex, chaotic, plus disorder ("unclear which of the other four contexts is predominant").
  - Simple ("known knowns"): sense, categorize, respond; best practice; delegate; danger: complacency, oversimplified classification, and the collapse into chaos when "success has bred complacency" (the article draws the simple domain next to chaotic on the map).
  - Complicated ("known unknowns"): sense, analyze, respond; expert diagnosis; "good practice" not best practice, since several right answers exist; danger: analysis paralysis, expert overconfidence, ignoring nonexperts.
  - Complex ("unknown unknowns"): probe, sense, respond; "safe-to-fail" experiments; patterns only emerge, hindsight does not lead to foresight; encourage dissent and diversity.
  - Chaotic: act, sense, respond; no right answers to look for; stabilize first.
  - Leaders mis-apply a favourite style across contexts. Quote: "hindsight no longer leads to foresight after a shift in context".
- Caution: a practitioner framework in a business magazine; I read no empirical test of it and no critical literature on Cynefin in this pass.

### A37-A38. Klein, pre-mortem (items 37-38)
- Citation (not read): Gary Klein (2007), "Performing a Project Premortem", Harvard Business Review, Sept 2007. https://hbsp.harvard.edu/product/F0709A-PDF-ENG: paywalled; the fetch showed only a site title. NOT READ.
- Item 37: https://en.wikipedia.org/wiki/Pre-mortem. Secondary. Read via summary fetch. Claims: assume the project has failed, work backward for causes; the idea is traced to prospective hindsight (Mitchell, Russo & Pennington 1989); benefits claimed (reduces groupthink, overconfidence, planning fallacy); the page cites only the 1989 study and "does not present direct evidence" that pre-mortems improve project outcomes (this is the summarizer's paraphrase; check page directly if cited).
- Klein's own description of the pre-mortem is now in A15 (McKinsey interview, p. 7); his 2007 article is still unread.
- What I do have from a primary: Kahneman & Klein 2009 describe the premortem (teams imagine the plan has failed and write down the reasons) and say it counters the gradual suppression of dissent as an organization commits to a plan.

### A39-A40. Wack 1985, scenario planning (items 39-40)
- Citation: Pierre Wack (1985), "Scenarios: Uncharted Waters Ahead", Harvard Business Review, Sept-Oct 1985 (the companion piece is "Scenarios: Shooting the Rapids", Nov-Dec 1985).
- URL read: https://www.andrewwmarshallfoundation.org/library/scenarios-uncharted-waters-ahead/. This is the HBR editor's abstract only. NOT read in full. Taylor & Francis chapter URL in the brief was truncated ("...") and was not fetched; paywalled in any case.
- What the abstract says: Shell developed "scenario planning" from the late 1960s/early 1970s; management was prepared for the eventuality, if not the timing, of the 1973 oil crisis, and in 1981 sold excess stock before prices collapsed; Shell's decision scenarios differ from usual US ones. These are HBR's claims about Shell, not independent evidence.

### A39b. Wack 1985, "Scenarios: Shooting the Rapids"
- Citation: Pierre Wack (1985), "Scenarios: Shooting the Rapids", Harvard Business Review 63(6), Nov-Dec 1985, 139-150. https://hbr.org/1985/11/scenarios-shooting-the-rapids
- Read 2026-11-28: full text of the owner-supplied reprint (12 pages, pp. 139-150, with exhibits). PRIMARY for Wack's own account; the evidence about Shell is Wack's own recollection, not independent data. The first article, "Uncharted Waters Ahead" (Sept-Oct 1985), is still abstract-only.
- Central claims:
  - Problem (p. 139): scenario work fails at "the interface of scenarios and decision makers"; a consultant who lays out six scenarios and says it is the managers' job to decide gets the reply "impenetrable".
  - Purpose (p. 140): scenarios "aim at perceptions inside the heads of decision makers" (p. 140), and work when they lead managers "to change and reorganize their inner models of reality". They are set against forecasts, which are "someone else's understanding and judgment crystallized in a figure" (p. 140).
  - Form (p. 146): "a few alternative and internally consistent pathways", "not a group of quasi-forecasts, one of which may be right"; never more than four, ideally "one plus two" (the surprise-free view, then two other worlds). Avoid a low-middle-high design because managers pick the middle (p. 146).
  - Two tests (pp. 146-147): "What do they leave out?" and "Do they lead to action?"; scenarios that do not push managers past past experience are "interesting speculation".
  - Purposes (p. 146): protective (understand risk) and entrepreneurial (find options not seen before); the second matters more in the long run.
  - Stable times (p. 150): when a manager's mental model matches reality, "decision scenarios have little or no leverage"; in rapid change they let managers "reperceive reality".
  - Shell evidence (pp. 146, 148-149): the 1975 "Constrained Growth" scenario matched the 1976-78 recovery and managers hedged; for 1981 the "Hard Times" scenario preceded Shell's stock cuts, which Wack says were "much greater and earlier" than the industry's, adding "It may be just a coincidence" (p. 149).
- Decision on use: LEFT OUT of the report. The target of a scenario is a human manager's mental model, and the chapter's decisions (fast default, slow call for plans, decision model for typed checks, escalate on an observable signal) change nothing if scenarios are added. The one link, "recheck at every model release", already has Anthropic's own sentence as its source. Where it would break for models: a model holds no inner model to reorganise between runs; agent failures are mostly frequent and small, so tests and retries do the work; Wack's evidence for success is anecdote.

### A41. Stanovich & West 2000 (dual-process terms)
- Citation: Keith E. Stanovich and Richard F. West (2000), "Individual differences in reasoning: Implications for the rationality debate?", Behavioral and Brain Sciences 23(5), 645-726.
- URL read: https://pages.ucsd.edu/~mckenzie/StanovichBBS.pdf. PRIMARY. Read: the dual-process passage and Table 3 in full; the rest of the 80-page target article only skimmed (95k words extracted).
- Claims: studies show that people who give the normatively "correct" answer on heuristics-and-biases tasks tend to have higher cognitive ability; a pattern consistent with two-process theories. "In order to emphasize the prototypical view ... the two systems have simply been generically labeled System 1 and System 2." System 1: "automatic, largely unconscious, and relatively undemanding of computational capacity"; System 2 is controlled processing, analytic intelligence. They note they are deliberately collapsing a family of theories (Epstein, Evans, Sloman etc.) with "family resemblances". Table 3 lists the other names (associative system, heuristic processing, tacit, implicit, experiential, etc.).
- So: the label is a convenience of the authors for a family of theories, introduced in a paper about individual differences and the rationality debate.

### A42. Kahneman, Nobel lecture / 2003 "Maps of bounded rationality" (dual-process in Kahneman)
- Citation: Daniel Kahneman, "Maps of Bounded Rationality: A Perspective on Intuitive Judgment and Choice", Nobel Prize Lecture 8 Dec 2002 (Les Prix Nobel 2002, pp. 449-489). The AER version is "Maps of Bounded Rationality: Psychology for Behavioral Economics", American Economic Review 93(5), 1449-1475 (2003). I read the Nobel lecture only.
- URL read: https://nobelprize.org/uploads/2018/06/kahnemann-lecture.pdf. PRIMARY. Read: section 1 and the framing passages in full; skimmed the rest.
- Claims: the intro says the work is about "intuitions", thoughts that come to mind quickly. Section 1 distinguishes an intuitive mode (automatic, rapid) and a controlled mode (deliberate, slower). Attribution: the "System 1 and System 2" labels are credited to Stanovich and West (2000). System 1 operations are "fast, automatic, effortless, associative, and difficult to control or modify"; System 2 "slower, serial, effortful, and deliberately controlled; ... potentially rule-governed". The lecture treats accessibility as "a continuum, not a dichotomy". Generic proposition: highly accessible impressions "control judgments and preferences, unless modified or overridden" by System 2. Also: "the rules that people apply in deliberate reasoning are sometimes false", and System 2 intervention does not guarantee a right answer.
- Kahneman here treats attribute substitution (answer an easy question in place of a hard one) as the mechanism of heuristics. Candidate analogy for agents: a model answering a nearby easier question. But see the warnings in B8.

### A43. Evans & Stanovich 2013 (defence and clarification)
- Citation: Jonathan St. B. T. Evans and Keith E. Stanovich (2013), "Dual-process theories of higher cognition: Advancing the debate", Perspectives on Psychological Science 8(3), 223-241. DOI 10.1177/1745691612460685.
- URL read: https://scottbarrykaufman.com///wp-content/uploads/2014/04/dual-process-theory-Evans_Stanovich_PoPS13.pdf (a copy hosted by a third party; the DOI is the safer citation). PRIMARY. Read: abstract, definitions, Table 1, and the sections on defaults/intervention and the five criticisms (targeted, not word by word).
- Claims:
  - They respond to 5 lines of criticism, accepting that some have force against some theories but calling them overstated.
  - "Type 1" (autonomous) vs "Type 2": Type 2 is defined by "cognitive decoupling and hypothetical thinking" and strong loading on working memory. Other features (fast/slow, conscious, high/low capacity, serial/parallel, normative responses) are "simply correlates that occur under well-defined conditions", not necessary or defining.
  - "We ... prefer to avoid" the System 1/2 terminology because it falsely suggests two specific systems; Type 1 is a heterogeneous bundle (modules, habits, implicit learning, practised skills).
  - Default-interventionist architecture (shared with Kahneman & Frederick 2002): fast Type 1 gives a default answer that Type 2 may or may not override. Contrast with parallel-competitive (Sloman). Parallel designs have the problem that "the fast horse must wait for the slow horse".
  - Evans (2012) fallacies of the "received view": Type 1 always causes bias and Type 2 always right; Type 1 is contextualized and Type 2 abstract; fast processing implies Type 1.
  - Practised skills that have become automatic are Type 1 yet can be accurate.
- This is the best primary for the claim "fast/slow is not the defining feature".

### A44. Keren & Schul 2009 (critique)
- Citation: Gideon Keren and Yaacov Schul (2009), "Two Is Not Always Better Than One: A Critical Evaluation of Two-System Theories", Perspectives on Psychological Science 4(6), 533-550. DOI 10.1111/j.1745-6924.2009.01164.x.
- Read 2026-11-28: full text of the owner-supplied PDF (18 pages of extracted text, pp. 533-550 with references; page refs below are the journal's). Earlier attempts (psychologicalscience.org, the authors' page, typeset.io) had failed. PRIMARY. It is a conceptual and methodological review, with no experiments, models or runs; it analyses "a generic model" of two-system theories (p. 534), so no sample, setup or run applies.
- Central claims:
  - Abstract (p. 533): two-system models "currently provide little scientific advance"; the authors ask for "more rigorous conceptual definitions" and stricter tests.
  - Vague terms (p. 534): the terms vary by author, and "the proliferation of models ... offers researchers and their readers a false sense of understanding". A process is not a system (p. 534).
  - Three criteria that a "system" model needs (p. 535): dichotomies, alienable characteristics, isolability. Dichotomising continuous attributes (hot-cold, automatic-controlled) loses information (pp. 537-538).
  - Alignment (pp. 538-539): to prove two systems one must show that the feature sets cluster and that hybrid combinations do not occur; with three dichotomous features five of six combinations must be ruled out. Hybrids exist, for example flexible, unconscious goal pursuit (p. 539).
  - Isolability (pp. 539-540): a system should work if the other is "completely inhibited or absent". Complex reasoning cannot run without System 1's associative networks, so the two are not isolable.
  - Default-interventionist (Evans 2008) (p. 540): they agree with Evans that "parallel isolable systems are unlikely", and add that a strict hierarchy of System 1 under System 2 "conflicts with recent findings" on goals and intentions in automatic processes.
  - Evidence (pp. 541-543): conflicting responses (Sloman's Criterion S, Linda) do not require two systems; findings such as belief bias under time pressure are compatible with one system, so the evidence "is not diagnostic"; double-dissociation shows components, not systems; neural evidence is scarce.
  - Prediction (pp. 543-544): the models were built "in retrospect"; Kahneman and Frederick (2002) embedded heuristics-and-biases in a two-system frame after the fact, and the same objections that Gigerenzer (1996) raised against the program apply.
  - Appeal and costs (pp. 544-546): dichotomies please the mind. They grant the defence that the models are used "only as a heuristic device" (p. 545), and answer that the models "may slow progress", oversimplify and favour testing presence over estimating parameters.
  - Alternative (pp. 546-547): a "unimodel": one mental apparatus that shifts among states and selects tools by task and goal (Kruglanski; Bruner's two modes). They do not say how many systems there are, and "wonder whether the question is meaningful" (p. 534; see also p. 546).
- Fit with E&S 2013 and M&B 2018: K&S predate both. E&S 2013 move from "systems" to "types", which answers part of the isolability and alignment charges (our reading); M&B 2018 cite the same family of objections. K&S's critique is of the generic two-system model; they treat default-interventionist models as a separate class they do not analyse in detail (p. 540).
- For the book: supports using the pair only as a metaphor and defining terms by observable output. Their unimodel (one apparatus, tools picked by task) is analogous to routing by role and task type, which is our inference and not a K&S claim.

### A45. Melnikoff & Bargh 2018 (critique)
- Citation: David E. Melnikoff and John A. Bargh (2018), "The Mythical Number Two", Trends in Cognitive Sciences 22(4), 280-293. DOI 10.1016/j.tics.2018.02.001.
- URL read: https://acmelab.yale.edu/sites/default/files/melnikoff_bargh_2018_mythical_number_2_0.pdf (author-accepted/proof PDF, 14 pages, with a proof header). PRIMARY. Read: abstract and the opening, "Two Types Bias" section; skimmed the rest. Its Highlights box in the PDF text looks mis-merged with another article, so ignore that.
- Claims: the "two types" framework "lacks empirical support, contradicts well-established findings, and is internally incoherent" (abstract); the assumption that psychological phenomena split into two types thwarts progress; the typology is a "convenient and seductive myth". The "Two Types Bias" section argues people reduce many categories to two to save effort and see alignment where none exists.
- Reply (not read): "The Insidious Number Two" (a Trends in Cognitive Sciences response, per search result). Evans & Stanovich 2013 is the earlier defence against the same family of arguments.

### A46. Gigerenzer's critique of heuristics-and-biases
- Citation: Gerd Gigerenzer (1996), "On Narrow Norms and Vague Heuristics: A Reply to Kahneman and Tversky (1996)", Psychological Review 103(3), 592-596. The thing it replies to: Kahneman & Tversky (1996), "On the reality of cognitive illusions", same issue, 582-591 (not read).
- URL read: https://www.csc2.ncsu.edu/faculty/mpsingh/local/Social/f25/wrap/readings/Gigerenzer-on-Kahneman+Tversky-1996.pdf (5 pages, a course-reading copy). PRIMARY. Read: full text.
- Claims (abstract and body): two charges: (1) "unnecessarily narrow norms" of sound reasoning are used to label judgments "cognitive illusions"; (2) "vague heuristics that explain everything and nothing". Representativeness, availability and anchoring can be invoked after the fact to explain opposite results, so they are not falsifiable. He wants detailed process models that predict when judgments are good and when they fail, and shows that frequency formats change performance, with models predicting when. He says statisticians build a model from the content of a problem, while heuristics-and-biases starts from a convenient statistical rule and checks for deviation (cab problem contrast with Birnbaum 1983).
- Not the same as saying heuristics are good. His constructive programme is the fast-and-frugal work (A11).

---

## B. What transfers to agents, as analogy

Rules for the textbook: say "by analogy" every time; never say "System 1 models" as though the term had empirical content for LLMs; no human result in this note was measured on a language model. Strength ratings are my judgment of the analogy's usefulness, not a measured quantity.

### B1. Kahneman & Klein's conditions as a trust test for a fast model's output
- Human claim: intuition is trustworthy only if (a) the environment is high-validity and (b) the judge had enough practice with rapid, clear feedback. Confidence is not evidence of either (Kahneman & Klein 2009, p. 10).
- Mapping: a fast/cheap model's answer for a task type is more trustworthy when the task has stable cue-outcome structure (classification into a fixed taxonomy, extraction with a schema, intent routing) and when there is a body of labelled outcomes for that task type. For tasks with long-delayed or ambiguous ground truth (strategy, forecasting, open-ended judgment) the analogy says be wary of fast outputs however fluent.
- Strength: moderate as a design heuristic for choosing which task types to give a fast model; weak as an explanation of anything about models.
- Where it breaks:
  - "Opportunity to learn with feedback" for a deployed model means training data and post-training plus your own evals. It does not accumulate with use. The human condition is about the individual's learning history in this environment; the nearest analog is the evidence from your eval set that this model does well on this task distribution. The analogy therefore says "measure per task type", not "trust fast models in regular domains".
  - Models are not calibrated by default, and confidence signals (verbal confidence, token probability) are weak or domain-dependent; I did not research this. The paper's claim that confidence is unreliable is a claim about humans, but it is a warning against using a model's self-reported confidence as the routing signal without checking it. Do not cite Kahneman & Klein as evidence either way for models.
  - Environment validity is a property of the task and data, and for agents the environment shifts (new tools, new user inputs, adversarial input). A model can face a "high-validity" task yet receive an out-of-distribution input.
  - Humans' recognition fails silently outside their domain boundary; Kahneman & Klein note it is hard for experts and observers to see the boundary (p. 11). Same shape of risk for models, but this is again analogy.
- Overclaim to avoid: "Kahneman says fast thinking is fine in regular environments, therefore small models are fine for easy tasks." The paper says nothing about model size, and "easy" is not "high-validity".

### B2. Satisficing and aspiration levels as a cascade's stopping rule
- Human claim (Simon, primary): when optimizing is infeasible, search sequentially and stop at the first option meeting an aspiration level; this makes search time depend on density of acceptable options, not total size; aspirations adjust up when met easily and down when missed.
- Mapping: a cascade (try cheap model, accept if the output passes an acceptance test, else escalate) is a satisficing search over models/attempts. The acceptance test is the aspiration level. Adaptive thresholds that rise when cheap answers keep passing and fall when escalations are frequent mirror Simon's adjustment.
- Strength: strong structurally. This is an almost literal description of the algorithm. It's the best fit in this note.
- Where it breaks:
  - Simon's aspiration is the agent's own goal. In a cascade the acceptance test is an external verifier (rules, tests, a judge model, a confidence score); the quality of the whole system rests on whether that verifier is valid. A weak verifier turns satisficing into accepting garbage.
  - Simon rejects folding search cost into an optimal-stopping calculation because it is infeasible for novel choices; but for high-volume routine routing it is feasible (he allows "relatively routine and repetitive choices"), and ML routers do exactly that, with learned cost-quality trade-offs. So the textbook should present the learned router as the optimal-stopping alternative Simon cautioned about, usable in the routine, repeated regime, not as satisficing.
  - Human search is over options in the world; cascade escalation re-queries a new model on the same question. Failures correlated across models (same blind spot) break the independence implicit in "try again".
  - Simon's needle-in-haystack claim concerns generating candidates cheaply and checking cheaply; it assumes verification is cheap relative to generation. If checking is as costly as solving, satisficing saves little.

### B3. Ecological rationality, less-is-more, bias-variance
- Human claim (Luan, Reb, Gigerenzer 2019; SEP 3.5, 4.3): the right strategy depends on the match between strategy and environment structure; with small samples and noisy outcomes, a simple heuristic can out-predict a complex model out of sample because it has lower variance, even though it is more biased.
- Mapping: a simple router or rule (length, keyword, task type) can beat a learned or LLM-based router when you have little routing data or high noise; a cheap model with a narrow prompt can beat an expensive model when the task structure is simple and the larger model's flexibility adds variance (e.g. inconsistency run to run). More generally: design for "match to environment", and estimate the environment on your own eval data.
- Strength: moderate-to-strong as a design principle for routers and simple fallbacks (especially "start with a simple rule and measure whether complexity helps"); weak as a claim about LLM behaviour itself.
- Where it breaks:
  - The bias-variance argument is about estimating a model from a small sample. A pretrained LLM is not fit to your small sample; the relevant variance is sampling variance and prompt sensitivity. Analogy at the level of "simple often wins when data is scarce" holds for router training, not for the base model.
  - Evidence base: one personnel-selection task and simulated environments (Luan et al.). In Study 2 a linear model wins when environments are linear and data is plentiful (the paper's own footnote). Less-is-more is a conditional result, not a universal.
  - SEP notes the bias-variance decomposition in the standard form is for squared loss; for classification errors (0-1 loss) the picture differs. Routing is often classification.
  - Gigerenzer's heuristics are deliberately transparent and fixed; LLM-based "heuristics" are opaque. The transparency benefit does not carry over.

### B4. Cynefin domains mapped to a call, a workflow and a loop
- Human claim (Snowden & Boone 2007): match management style to the cause-effect structure of the situation; sense-categorize-respond for simple, sense-analyze-respond (experts) for complicated, probe-sense-respond (safe-to-fail experiments) for complex, act-sense-respond for chaotic; disorder is not knowing which applies; misclassification, especially treating complex as simple, is the main failure.
- Mapping (my proposal, not from the article):
  - Simple -> a single model call or a deterministic route: classify and respond by established rule. Danger carried over: oversimplified classification, "entrained thinking".
  - Complicated -> a designed workflow: analysis by decomposition, with experts (people or a stronger model) having built the steps ahead of time. Danger: analysis paralysis, expert blind spots.
  - Complex -> an agent loop with probes: act in small reversible steps, observe, adapt, because the right path is not knowable ahead of time. Cynefin's "safe-to-fail" maps to sandboxing, reversible actions, small tool calls with checks.
  - Chaotic -> stabilize first: kill switch, rate-limit, rollback, then act.
  - Disorder -> the router cannot classify the task. Good analogy for a "don't know" route/escalation to human.
- Strength: moderate and fruitful as a vocabulary for the call/workflow/loop choice; it is a classification of problems, not of models, so it fits routing better than the System 1/2 split does. It also says the first decision is to diagnose the context.
- Where it breaks:
  - Cynefin is about cause-and-effect in organizational or social situations. For software tasks the "domain" is often a property of the task spec plus the tooling, and is knowable. Using "complex" for "an LLM is unpredictable" conflates unpredictability of the actor with unpredictability of the environment.
  - It is a practitioner framework; I read no empirical validation or critique. Do not present it as established science.
  - Cynefin's advice for "simple" is to delegate and use best practice; for an agent, a model call in the simple domain still needs a validator.

### B5. OODA's orientation step
- Human claim (secondary only, see A25-A29): Boyd's decision cycle is Observe-Orient-Decide-Act, with orientation, the stored mental model, the most important part; the faster cycle of orienting and acting wins. Boyd's 1976 paper (primary) argues that mental models must be repeatedly broken apart and rebuilt to stay matched to a changing environment.
- Mapping: orientation = how the agent interprets new observations given its current context (memory, system prompt, plan); a failure to re-orient after surprising tool output is the agent version of holding a stale model. The paper's main point (revise your model when reality mismatches) supports "replan when observations contradict the plan".
- Strength: weak-to-moderate; metaphor-level. "Orient" is vague enough to cover anything.
- Where it breaks:
  - Boyd's setting is adversarial competition between two decision cycles (tempo relative to an opponent). Most agents are not in a contest for tempo; faster loops do not obviously help if the bottleneck is correctness.
  - The primary I read (D&C, 1976) does not include OODA; I did not read the briefings. Textbook statements about OODA must cite the briefings.
  - Boyd's argument leans on loose uses of Godel, Heisenberg and thermodynamics as analogies; don't import them as support.

### B6. The pre-mortem as an adversarial verifier step
- Human claim: before committing, imagine the plan has already failed and write down why (Klein 2007; Kahneman & Klein 2009 describe it as a semi-formal method that counters overconfidence and the suppression of doubt as commitment grows).
- Klein's own account (A15, McKinsey p. 7) gives the mechanism as social ("avoid anything that might disrupt harmony" becomes "surface potential problems"), and Kahneman's only outcome claim there is a guess (p. 7). Kahneman's remark that independent judgments "decorrelate errors" (p. 8) supports a separate critic.
- Mapping: a verifier or red-team step run before an irreversible action: prompt a model (or a different model) to assume the plan failed and list causes, then check the plan against them. Prospective hindsight is a way to elicit objections that a plain "any problems?" does not.
- Strength: moderate as an agent design pattern; it is a prompt/process structure, not dependent on human-specific facts. But the human evidence is thin (see A37-38); I found no outcome studies in the sources read.
- Where it breaks:
  - The human mechanism is social: it gives licence to dissent in a group with committed members. A single model critiquing its own plan has no social cost to dissent but shares the same blind spots; self-critique can reproduce the plan's assumptions. Use a separate context or model, and ground the critique in tool checks.
  - A model told "assume this failed" may invent plausible but false failure modes (the Wikipedia page notes the same risk for humans: if failure is assumed, threats may be unreal). Needs a filter, such as a test or a lookup.

### B7. Scenario planning as planning under deep uncertainty
- Human claim (Wack 1985; first article by abstract only, second in full, A39b): Shell developed scenarios rather than point forecasts; management was prepared for the 1973 oil crisis "if not the timing".
- Mapping: when outcomes can't be predicted, generate a few distinct futures, test the plan against each, and look for robust choices. For agents, planning against several tool or environment states (API fails, data missing, user changes goal) and picking plans that survive them.
- Strength: weak. Now read in full (A39b, second article only). Wack's aim is to change managers' inner models, and its tests (what is left out, does it lead to action) have no bearing on the report's decisions, so the report leaves it out.
- Where it breaks: it's a managerial discipline for strategic uncertainty with rare, large shocks; agent tasks mostly face frequent small failures where testing and retries do the work. Sampling many plans from a model is not the same as constructing structurally different scenarios; sampled plans tend to be similar. Shell's success is Wack's/HBR's own account.

### B8. Munger's checklists as a guard against fast-judgment errors
- Human claim: list the known causes of misjudgment and run through the list; "procedures, including use of checklists" are "almost always helpful" against availability-misweighing; seek disconfirming evidence; use skeptical people.
- Mapping: a fixed checklist step before answering or acting (constraints satisfied? source checked? disconfirming evidence sought?), run as a gate, cheap relative to a full slow pass. Checklists are one way of making a fast answer pass through a fixed slow check without a full reasoning pass.
- Strength: moderate as a pattern (checklists work for people in some domains, but my sources here give Munger's assertion, not evidence), weak as a mapping of "tendencies" to model failure modes: LLM failure modes (hallucination, sycophancy, instruction drift) are not the 25 tendencies and should be derived from model evaluations, not from Munger's list.
- Where it breaks: a model can fill in a checklist without doing the checks (it can claim compliance); checklist items need to be verifiable against tools or tests. Munger's list is a practitioner synthesis with no test of coverage.

### B9. The dual-process framing itself, and what the routing literature should not borrow
- What the primaries support: a fast default plus an optional slower override is the default-interventionist architecture (Kahneman & Frederick; Evans & Stanovich). This is a legitimate structural analogy for "answer with the cheap model, escalate on a trigger". The key open question in the human literature is what triggers intervention, and the answer there is mixed (feeling of difficulty, conflict detection, individual differences in disposition) and not well enough defined to port.
- What the primaries do not support: (a) fast = intuitive = error-prone and slow = reliable (Evans & Stanovich list this as a fallacy; Kahneman & Klein p. 8 note that System 2 checking is often skipped and Evans 2007 notes System 2 can satisfice; Kahneman's lecture notes System 2 rules can be wrong); (b) that there are exactly two systems (Melnikoff & Bargh say no evidence; Evans & Stanovich say "types", a heterogeneous Type 1; Kahneman's own "continuum" of accessibility); (c) that a bigger or reasoning model is "System 2". The analogy of "System 2" as a model that deliberates in tokens is superficially tempting. In Evans & Stanovich's terms the defining feature is working-memory-loaded hypothetical thinking; chain-of-thought tokens can look like this, but I have no basis to say they function the same way, and the ML papers' reasoning-model claims are outside this note.
- Strength: the structural analogy (default plus intervention) is moderate; the vocabulary transfer is weak and risks misleading readers.
- Suggested wording for the textbook: "Kahneman's fast and slow thinking is a useful picture of a cheap default with an optional deliberate check. It is a metaphor here. Cognitive psychologists dispute whether it is two systems at all, and its main defenders say speed is not what defines the slow mode."

---

## C. Open disagreements the textbook should state fairly
- Are heuristics mostly a source of error (Tversky & Kahneman 1974 and the heuristics-and-biases tradition) or mostly adaptive tools whose success depends on environment (Gigerenzer, Klein)? Kahneman & Klein 2009 reach a common boundary condition, but Klein says they still disagree (A16), and the 2010 interview shows disagreement on checklists and on postponing intuition (A15).
- Is the norm used to call something an error correct (SEP section 5.1; Gigerenzer 1996)? Matters for any evaluation: the grader sets the norm.
- Is dual-process theory a real distinction (Evans & Stanovich 2013) or a seductive myth (Melnikoff & Bargh 2018; Keren & Schul 2009, read in full, A44)?
- Satisficing vs optimal stopping with search cost (Simon's reply in A5).

## D. Things I could not read in primary form (checklist)
- Not read at all: item 6 (ResearchGate), item 7 (PubMed T&K page; but I read the T&K 1974 full text elsewhere), item 14 (PubMed K&K), item 18 (Kahneman publications page, 403), items 12, 13 (SMU and behavioraleconomics pages empty), item 31, 34-36 (PubMed Snowden, toolshero, HBR insight page), items 8, 9, 21-23 (Semantic Scholar, multiplenatures, Munger summaries), item 24 beyond catalog data, item 29 (Scribd, skipped).
- Paywalled/abstract only: Klein 2007 HBR pre-mortem (item 38, paywalled; still unread; the owner's HBR April 2008 letters page, `hbr-2008-04-letters-premortem.txt`, is one reader's letter comparing the pre-mortem to FMEA and does not confirm Klein's article, so it is not cited); Wack 1985 "Uncharted Waters Ahead" (abstract only; the Taylor & Francis link in the brief was truncated; the second article is now read, A39b); Snowden & Boone via reprint PDF on a third-party site (full text read, but a copy on a site I did not verify as licensed).
- Not found/read: Boyd's OODA briefings (primary for OODA); Kahneman & Tversky 1996 (the paper Gigerenzer replies to); the second half of the SEP entry (incl. section 5.2); the AER 2003 version of "Maps of bounded rationality" (I read the Nobel lecture version); Kahneman's *Thinking, Fast and Slow* (2011) itself; any evidence on LLM calibration or routing (out of scope by design).
- Primary sources I did read in full or nearly: Keren & Schul 2009 and the McKinsey interview and Wack's "Shooting the Rapids" (owner-supplied copies, 2026-11-28); Simon "Satisficing"; Tversky & Kahneman 1974; Kahneman & Klein 2009; Luan, Reb & Gigerenzer 2019 (targeted); Boyd D&C; Snowden & Boone 2007; Munger transcript (searched); Stanovich & West 2000 (dual-process passage only); Kahneman Nobel lecture (core sections); Evans & Stanovich 2013 (core sections); Melnikoff & Bargh 2018 (abstract and parts); Gigerenzer 1996.
