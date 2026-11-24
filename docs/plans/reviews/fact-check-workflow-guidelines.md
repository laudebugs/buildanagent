# Fact-check: the workflow guideline

This log checks the claims of `docs/guidelines/building-a-workflow-with-a-model.md` on its first draft, in November 2026. Claims about the authors' own project have no public source and stay ⚠️.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

**Totals:** 11 claims: 5 ✅, 1 ✏️, 5 ⚠️.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| docs/workflow-guidelines-1 | The OWASP guidance on CSV injection lists `=`, `+`, `-` and `@` as trigger characters and adds the tab and the carriage return | ✅ | OWASP, "CSV Injection", community.owasp.org/attacks/CSV_Injection, read in November 2026 |
| docs/workflow-guidelines-2 | Efron and Tibshirani, *An Introduction to the Bootstrap*, Chapman & Hall, Monographs on Statistics and Applied Probability 57, first published 1993 | ✏️ | The publisher's page (Routledge) names the title, authors, publisher and series and dates the book 1994, the CRC edition; the 1993 first edition and the series number come from a library-catalogue record. The text says 1993, the first edition's year |
| docs/workflow-guidelines-3 | Wilson (1927), "Probable Inference, the Law of Succession, and Statistical Inference", Journal of the American Statistical Association 22 (158), pp. 209–212 | ✅ | Crossref record of DOI 10.1080/01621459.1927.10502953; the publisher's page itself refused the request |
| docs/workflow-guidelines-4 | McNemar (1947), "Note on the Sampling Error of the Difference Between Correlated Proportions or Percentages", Psychometrika 12 (2), pp. 153–157 | ✅ | Crossref record of DOI 10.1007/BF02295996; the publisher's page asked for a login |
| docs/workflow-guidelines-5 | Dror, Baumer, Shlomov and Reichart (2018), "The Hitchhiker's Guide to Testing Statistical Significance in Natural Language Processing", ACL 2018, pp. 1383–1392, describe McNemar's test for paired binary outcomes and a bootstrap or randomisation test for small samples | ⚠️ | ACL Anthology page P18-1128 confirms title, authors, venue and pages; the passages on McNemar's test, the paired bootstrap and the decision tree were read in the PDF, but not the whole paper |
| docs/workflow-guidelines-6 | Yao, Shinn, Razavi and Narasimhan, "τ-bench", arXiv 2406.12045, 17 June 2024, introduced pass^k to evaluate reliability over multiple trials | ⚠️ | The arXiv abstract page, read in November 2026; the paper's body was not read |
| docs/workflow-guidelines-7 | Zero failures in 300 runs puts the 95 percent upper bound on the failure rate near one percent (3 divided by the number of runs, the rule of three) | ✅ | Arithmetic: 3/300 = 1 percent |
| docs/workflow-guidelines-8 | On sheets from the authors' own generator, a rules-only version nearly matched the version that added a model, so that test could not show the model's value | ⚠️ | The authors' own project, November 2026; the figures are not published, so the claim cannot be checked from this repository |
| docs/workflow-guidelines-9 | A worst-case cost projection that charges every call its whole output limit ran several times higher than the real cost of the run | ⚠️ | The authors' own project, November 2026; not published |
| docs/workflow-guidelines-10 | The practices of sections 6 to 11 (stamps that hash more files than expected, a probe whose short connect timeout hid a working client, a key dropped before an effect showed, a rebase that left merge markers in a log, a wrap rule that widened unrelated pages, an icon served with a generic binary type) come from the authors' own project | ⚠️ | Reported by the project's builders in November 2026; none has a public source |
| docs/workflow-guidelines-11 | The guideline names no company, product, host, project id, person or internal document, and gives no evaluation figure | ✅ | Searched by the authors before the pull request; a reviewer should repeat the search |
