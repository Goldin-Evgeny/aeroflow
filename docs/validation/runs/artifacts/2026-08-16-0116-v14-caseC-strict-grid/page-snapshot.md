# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: aij-urban.gpu.spec.ts >> V14 Case C at 270 degrees
- Location: apps\studio\e2e\aij-urban.gpu.spec.ts:133:1

# Error details

```
Error: expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 0.66
Received:    0.4583333333333333
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e6]: AEROFLOW / VALIDATION M11
        - heading "AIJ Urban Wind Bench" [level=1] [ref=e7]
        - paragraph [ref=e8]: Official Case C city blocks and Case E Niigata data. Screening-grade LES evidence.
      - generic [ref=e9]: OFFICIAL SOURCE DATA
    - generic [ref=e10]:
      - generic [ref=e11]:
        - generic [ref=e12]: Preset
        - group "AIJ case" [ref=e13]:
          - button "Case C" [pressed] [ref=e14] [cursor=pointer]
          - button "Case E" [ref=e15] [cursor=pointer]
      - generic [ref=e16]:
        - generic [ref=e17]: Wind from
        - combobox "Wind from" [ref=e18] [cursor=pointer]:
          - option "270 deg" [selected]
          - option "247.5 deg"
          - option "225 deg"
      - generic [ref=e19]:
        - generic [ref=e20]: Cell budget
        - combobox "Cell budget" [ref=e21] [cursor=pointer]:
          - option "2.00M cells"
          - option "5.00M cells"
          - option "10.00M cells"
          - option "18.87M cells"
          - option "190.00M cells (smoke override)" [selected]
      - generic [ref=e22]:
        - generic [ref=e23]: Storage
        - combobox "Storage" [ref=e24] [cursor=pointer]:
          - option "FP16 native" [selected]
          - option "FP32"
      - generic [ref=e25]:
        - button "Run preset" [ref=e26] [cursor=pointer]
        - button "Resume saved" [ref=e27] [cursor=pointer]
        - button "Stop" [disabled] [ref=e28]
        - button "Save checkpoint" [ref=e29] [cursor=pointer]
        - button "Export JSON" [ref=e30] [cursor=pointer]
    - generic [ref=e32]:
      - strong [ref=e33]: Run complete
      - generic [ref=e34]: Report is ready for export
    - generic [ref=e37]:
      - generic [ref=e38]:
        - term [ref=e39]: Grid
        - definition [ref=e40]: 883 x 303 x 701
      - generic [ref=e41]:
        - term [ref=e42]: Spacing
        - definition [ref=e43]: 0.00793 m
      - generic [ref=e44]:
        - term [ref=e45]: Averaging
        - definition [ref=e46]: 10.00 / 10 flow-throughs
      - generic [ref=e47]:
        - term [ref=e48]: Hit rate q
        - definition [ref=e49]: "0.458"
      - generic [ref=e50]:
        - term [ref=e51]: Pearson r
        - definition [ref=e52]: not gated
      - generic [ref=e53]:
        - term [ref=e54]: Verdict
        - definition [ref=e55]: FAIL
    - generic [ref=e56]:
      - 'figure "Simulated vs measured VDI allowed deviation: 0.25 U/Uref" [ref=e57]':
        - generic [ref=e58]:
          - heading "Simulated vs measured" [level=2] [ref=e59]
          - generic [ref=e60]: "VDI allowed deviation: 0.25 U/Uref"
      - generic [ref=e62]:
        - generic [ref=e63]:
          - heading "Probe evidence" [level=2] [ref=e64]
          - generic [ref=e65]: 120 points
        - table [ref=e67]:
          - rowgroup [ref=e68]:
            - row "Probe Measured Simulated Delta VDI" [ref=e69]:
              - columnheader "Probe" [ref=e70]
              - columnheader "Measured" [ref=e71]
              - columnheader "Simulated" [ref=e72]
              - columnheader "Delta" [ref=e73]
              - columnheader "VDI" [ref=e74]
          - rowgroup [ref=e75]:
            - row "63 1.083 0.510 -0.573 MISS" [ref=e76]:
              - cell "63" [ref=e77]
              - cell "1.083" [ref=e78]
              - cell "0.510" [ref=e79]
              - cell "-0.573" [ref=e80]
              - cell "MISS" [ref=e81]
            - row "54 0.955 0.700 -0.255 MISS" [ref=e82]:
              - cell "54" [ref=e83]
              - cell "0.955" [ref=e84]
              - cell "0.700" [ref=e85]
              - cell "-0.255" [ref=e86]
              - cell "MISS" [ref=e87]
            - row "45 0.718 0.439 -0.279 MISS" [ref=e88]:
              - cell "45" [ref=e89]
              - cell "0.718" [ref=e90]
              - cell "0.439" [ref=e91]
              - cell "-0.279" [ref=e92]
              - cell "MISS" [ref=e93]
            - row "31 0.716 0.417 -0.299 MISS" [ref=e94]:
              - cell "31" [ref=e95]
              - cell "0.716" [ref=e96]
              - cell "0.417" [ref=e97]
              - cell "-0.299" [ref=e98]
              - cell "MISS" [ref=e99]
            - row "32 0.903 0.707 -0.196 HIT" [ref=e100]:
              - cell "32" [ref=e101]
              - cell "0.903" [ref=e102]
              - cell "0.707" [ref=e103]
              - cell "-0.196" [ref=e104]
              - cell "HIT" [ref=e105]
            - row "33 1.038 0.530 -0.508 MISS" [ref=e106]:
              - cell "33" [ref=e107]
              - cell "1.038" [ref=e108]
              - cell "0.530" [ref=e109]
              - cell "-0.508" [ref=e110]
              - cell "MISS" [ref=e111]
            - row "66 0.975 0.387 -0.588 MISS" [ref=e112]:
              - cell "66" [ref=e113]
              - cell "0.975" [ref=e114]
              - cell "0.387" [ref=e115]
              - cell "-0.588" [ref=e116]
              - cell "MISS" [ref=e117]
            - row "62 1.059 0.570 -0.489 MISS" [ref=e118]:
              - cell "62" [ref=e119]
              - cell "1.059" [ref=e120]
              - cell "0.570" [ref=e121]
              - cell "-0.489" [ref=e122]
              - cell "MISS" [ref=e123]
            - row "53 0.885 0.772 -0.113 HIT" [ref=e124]:
              - cell "53" [ref=e125]
              - cell "0.885" [ref=e126]
              - cell "0.772" [ref=e127]
              - cell "-0.113" [ref=e128]
              - cell "HIT" [ref=e129]
            - row "44 0.778 0.410 -0.368 MISS" [ref=e130]:
              - cell "44" [ref=e131]
              - cell "0.778" [ref=e132]
              - cell "0.410" [ref=e133]
              - cell "-0.368" [ref=e134]
              - cell "MISS" [ref=e135]
            - row "22 0.890 0.462 -0.428 MISS" [ref=e136]:
              - cell "22" [ref=e137]
              - cell "0.890" [ref=e138]
              - cell "0.462" [ref=e139]
              - cell "-0.428" [ref=e140]
              - cell "MISS" [ref=e141]
            - row "23 0.927 0.603 -0.324 MISS" [ref=e142]:
              - cell "23" [ref=e143]
              - cell "0.927" [ref=e144]
              - cell "0.603" [ref=e145]
              - cell "-0.324" [ref=e146]
              - cell "MISS" [ref=e147]
            - row "24 0.828 0.628 -0.201 HIT" [ref=e148]:
              - cell "24" [ref=e149]
              - cell "0.828" [ref=e150]
              - cell "0.628" [ref=e151]
              - cell "-0.201" [ref=e152]
              - cell "HIT" [ref=e153]
            - row "25 0.931 0.604 -0.328 MISS" [ref=e154]:
              - cell "25" [ref=e155]
              - cell "0.931" [ref=e156]
              - cell "0.604" [ref=e157]
              - cell "-0.328" [ref=e158]
              - cell "MISS" [ref=e159]
            - row "26 0.848 0.474 -0.375 MISS" [ref=e160]:
              - cell "26" [ref=e161]
              - cell "0.848" [ref=e162]
              - cell "0.474" [ref=e163]
              - cell "-0.375" [ref=e164]
              - cell "MISS" [ref=e165]
            - row "27 0.737 0.385 -0.352 MISS" [ref=e166]:
              - cell "27" [ref=e167]
              - cell "0.737" [ref=e168]
              - cell "0.385" [ref=e169]
              - cell "-0.352" [ref=e170]
              - cell "MISS" [ref=e171]
            - row "28 0.867 0.760 -0.107 HIT" [ref=e172]:
              - cell "28" [ref=e173]
              - cell "0.867" [ref=e174]
              - cell "0.760" [ref=e175]
              - cell "-0.107" [ref=e176]
              - cell "HIT" [ref=e177]
            - row "29 1.034 0.590 -0.444 MISS" [ref=e178]:
              - cell "29" [ref=e179]
              - cell "1.034" [ref=e180]
              - cell "0.590" [ref=e181]
              - cell "-0.444" [ref=e182]
              - cell "MISS" [ref=e183]
            - row "30 0.956 0.340 -0.616 MISS" [ref=e184]:
              - cell "30" [ref=e185]
              - cell "0.956" [ref=e186]
              - cell "0.340" [ref=e187]
              - cell "-0.616" [ref=e188]
              - cell "MISS" [ref=e189]
            - row "65 0.948 0.522 -0.427 MISS" [ref=e190]:
              - cell "65" [ref=e191]
              - cell "0.948" [ref=e192]
              - cell "0.522" [ref=e193]
              - cell "-0.427" [ref=e194]
              - cell "MISS" [ref=e195]
            - row "61 0.965 0.634 -0.331 MISS" [ref=e196]:
              - cell "61" [ref=e197]
              - cell "0.965" [ref=e198]
              - cell "0.634" [ref=e199]
              - cell "-0.331" [ref=e200]
              - cell "MISS" [ref=e201]
            - row "52 0.878 0.625 -0.253 MISS" [ref=e202]:
              - cell "52" [ref=e203]
              - cell "0.878" [ref=e204]
              - cell "0.625" [ref=e205]
              - cell "-0.253" [ref=e206]
              - cell "MISS" [ref=e207]
            - row "43 0.996 0.471 -0.525 MISS" [ref=e208]:
              - cell "43" [ref=e209]
              - cell "0.996" [ref=e210]
              - cell "0.471" [ref=e211]
              - cell "-0.525" [ref=e212]
              - cell "MISS" [ref=e213]
            - row "13 1.136 0.962 -0.174 HIT" [ref=e214]:
              - cell "13" [ref=e215]
              - cell "1.136" [ref=e216]
              - cell "0.962" [ref=e217]
              - cell "-0.174" [ref=e218]
              - cell "HIT" [ref=e219]
            - row "14 1.101 1.021 -0.080 HIT" [ref=e220]:
              - cell "14" [ref=e221]
              - cell "1.101" [ref=e222]
              - cell "1.021" [ref=e223]
              - cell "-0.080" [ref=e224]
              - cell "HIT" [ref=e225]
            - row "15 0.976 0.929 -0.047 HIT" [ref=e226]:
              - cell "15" [ref=e227]
              - cell "0.976" [ref=e228]
              - cell "0.929" [ref=e229]
              - cell "-0.047" [ref=e230]
              - cell "HIT" [ref=e231]
            - row "16 1.022 1.004 -0.018 HIT" [ref=e232]:
              - cell "16" [ref=e233]
              - cell "1.022" [ref=e234]
              - cell "1.004" [ref=e235]
              - cell "-0.018" [ref=e236]
              - cell "HIT" [ref=e237]
            - row "17 1.087 0.994 -0.093 HIT" [ref=e238]:
              - cell "17" [ref=e239]
              - cell "1.087" [ref=e240]
              - cell "0.994" [ref=e241]
              - cell "-0.093" [ref=e242]
              - cell "HIT" [ref=e243]
            - row "18 0.890 0.493 -0.397 MISS" [ref=e244]:
              - cell "18" [ref=e245]
              - cell "0.890" [ref=e246]
              - cell "0.493" [ref=e247]
              - cell "-0.397" [ref=e248]
              - cell "MISS" [ref=e249]
            - row "19 0.841 0.601 -0.240 HIT" [ref=e250]:
              - cell "19" [ref=e251]
              - cell "0.841" [ref=e252]
              - cell "0.601" [ref=e253]
              - cell "-0.240" [ref=e254]
              - cell "HIT" [ref=e255]
            - row "20 0.977 0.660 -0.317 MISS" [ref=e256]:
              - cell "20" [ref=e257]
              - cell "0.977" [ref=e258]
              - cell "0.660" [ref=e259]
              - cell "-0.317" [ref=e260]
              - cell "MISS" [ref=e261]
            - row "21 1.002 0.502 -0.500 MISS" [ref=e262]:
              - cell "21" [ref=e263]
              - cell "1.002" [ref=e264]
              - cell "0.502" [ref=e265]
              - cell "-0.500" [ref=e266]
              - cell "MISS" [ref=e267]
            - row "64 0.747 0.469 -0.278 MISS" [ref=e268]:
              - cell "64" [ref=e269]
              - cell "0.747" [ref=e270]
              - cell "0.469" [ref=e271]
              - cell "-0.278" [ref=e272]
              - cell "MISS" [ref=e273]
            - row "60 0.771 0.518 -0.253 MISS" [ref=e274]:
              - cell "60" [ref=e275]
              - cell "0.771" [ref=e276]
              - cell "0.518" [ref=e277]
              - cell "-0.253" [ref=e278]
              - cell "MISS" [ref=e279]
            - row "51 0.758 0.513 -0.245 HIT" [ref=e280]:
              - cell "51" [ref=e281]
              - cell "0.758" [ref=e282]
              - cell "0.513" [ref=e283]
              - cell "-0.245" [ref=e284]
              - cell "HIT" [ref=e285]
            - row "42 0.960 0.751 -0.210 HIT" [ref=e286]:
              - cell "42" [ref=e287]
              - cell "0.960" [ref=e288]
              - cell "0.751" [ref=e289]
              - cell "-0.210" [ref=e290]
              - cell "HIT" [ref=e291]
            - row "4 1.157 0.864 -0.293 MISS" [ref=e292]:
              - cell "4" [ref=e293]
              - cell "1.157" [ref=e294]
              - cell "0.864" [ref=e295]
              - cell "-0.293" [ref=e296]
              - cell "MISS" [ref=e297]
            - row "5 0.944 0.657 -0.288 MISS" [ref=e298]:
              - cell "5" [ref=e299]
              - cell "0.944" [ref=e300]
              - cell "0.657" [ref=e301]
              - cell "-0.288" [ref=e302]
              - cell "MISS" [ref=e303]
            - row "6 0.837 0.472 -0.365 MISS" [ref=e304]:
              - cell "6" [ref=e305]
              - cell "0.837" [ref=e306]
              - cell "0.472" [ref=e307]
              - cell "-0.365" [ref=e308]
              - cell "MISS" [ref=e309]
            - row "7 0.952 0.612 -0.340 MISS" [ref=e310]:
              - cell "7" [ref=e311]
              - cell "0.952" [ref=e312]
              - cell "0.612" [ref=e313]
              - cell "-0.340" [ref=e314]
              - cell "MISS" [ref=e315]
            - row "8 1.127 0.860 -0.268 MISS" [ref=e316]:
              - cell "8" [ref=e317]
              - cell "1.127" [ref=e318]
              - cell "0.860" [ref=e319]
              - cell "-0.268" [ref=e320]
              - cell "MISS" [ref=e321]
            - row "9 0.942 0.776 -0.166 HIT" [ref=e322]:
              - cell "9" [ref=e323]
              - cell "0.942" [ref=e324]
              - cell "0.776" [ref=e325]
              - cell "-0.166" [ref=e326]
              - cell "HIT" [ref=e327]
            - row "10 0.821 0.508 -0.313 MISS" [ref=e328]:
              - cell "10" [ref=e329]
              - cell "0.821" [ref=e330]
              - cell "0.508" [ref=e331]
              - cell "-0.313" [ref=e332]
              - cell "MISS" [ref=e333]
            - row "11 0.798 0.536 -0.261 MISS" [ref=e334]:
              - cell "11" [ref=e335]
              - cell "0.798" [ref=e336]
              - cell "0.536" [ref=e337]
              - cell "-0.261" [ref=e338]
              - cell "MISS" [ref=e339]
            - row "12 0.817 0.469 -0.348 MISS" [ref=e340]:
              - cell "12" [ref=e341]
              - cell "0.817" [ref=e342]
              - cell "0.469" [ref=e343]
              - cell "-0.348" [ref=e344]
              - cell "MISS" [ref=e345]
            - row "59 0.661 0.433 -0.229 HIT" [ref=e346]:
              - cell "59" [ref=e347]
              - cell "0.661" [ref=e348]
              - cell "0.433" [ref=e349]
              - cell "-0.229" [ref=e350]
              - cell "HIT" [ref=e351]
            - row "50 0.694 0.429 -0.265 MISS" [ref=e352]:
              - cell "50" [ref=e353]
              - cell "0.694" [ref=e354]
              - cell "0.429" [ref=e355]
              - cell "-0.265" [ref=e356]
              - cell "MISS" [ref=e357]
            - row "41 0.870 0.566 -0.304 MISS" [ref=e358]:
              - cell "41" [ref=e359]
              - cell "0.870" [ref=e360]
              - cell "0.566" [ref=e361]
              - cell "-0.304" [ref=e362]
              - cell "MISS" [ref=e363]
            - row "103 0.918 0.544 -0.374 MISS" [ref=e364]:
              - cell "103" [ref=e365]
              - cell "0.918" [ref=e366]
              - cell "0.544" [ref=e367]
              - cell "-0.374" [ref=e368]
              - cell "MISS" [ref=e369]
            - row "112 0.649 0.417 -0.232 HIT" [ref=e370]:
              - cell "112" [ref=e371]
              - cell "0.649" [ref=e372]
              - cell "0.417" [ref=e373]
              - cell "-0.232" [ref=e374]
              - cell "HIT" [ref=e375]
            - row "121 0.608 0.418 -0.190 HIT" [ref=e376]:
              - cell "121" [ref=e377]
              - cell "0.608" [ref=e378]
              - cell "0.418" [ref=e379]
              - cell "-0.190" [ref=e380]
              - cell "HIT" [ref=e381]
            - row "58 0.645 0.403 -0.243 HIT" [ref=e382]:
              - cell "58" [ref=e383]
              - cell "0.645" [ref=e384]
              - cell "0.403" [ref=e385]
              - cell "-0.243" [ref=e386]
              - cell "HIT" [ref=e387]
            - row "49 0.688 0.367 -0.321 MISS" [ref=e388]:
              - cell "49" [ref=e389]
              - cell "0.688" [ref=e390]
              - cell "0.367" [ref=e391]
              - cell "-0.321" [ref=e392]
              - cell "MISS" [ref=e393]
            - row "40 0.700 0.396 -0.304 MISS" [ref=e394]:
              - cell "40" [ref=e395]
              - cell "0.700" [ref=e396]
              - cell "0.396" [ref=e397]
              - cell "-0.304" [ref=e398]
              - cell "MISS" [ref=e399]
            - row "104 0.647 0.331 -0.316 MISS" [ref=e400]:
              - cell "104" [ref=e401]
              - cell "0.647" [ref=e402]
              - cell "0.331" [ref=e403]
              - cell "-0.316" [ref=e404]
              - cell "MISS" [ref=e405]
            - row "113 0.572 0.359 -0.213 HIT" [ref=e406]:
              - cell "113" [ref=e407]
              - cell "0.572" [ref=e408]
              - cell "0.359" [ref=e409]
              - cell "-0.213" [ref=e410]
              - cell "HIT" [ref=e411]
            - row "122 0.597 0.400 -0.197 HIT" [ref=e412]:
              - cell "122" [ref=e413]
              - cell "0.597" [ref=e414]
              - cell "0.400" [ref=e415]
              - cell "-0.197" [ref=e416]
              - cell "HIT" [ref=e417]
            - row "57 0.543 0.332 -0.212 HIT" [ref=e418]:
              - cell "57" [ref=e419]
              - cell "0.543" [ref=e420]
              - cell "0.332" [ref=e421]
              - cell "-0.212" [ref=e422]
              - cell "HIT" [ref=e423]
            - row "48 0.569 0.394 -0.175 HIT" [ref=e424]:
              - cell "48" [ref=e425]
              - cell "0.569" [ref=e426]
              - cell "0.394" [ref=e427]
              - cell "-0.175" [ref=e428]
              - cell "HIT" [ref=e429]
            - row "39 0.641 0.400 -0.240 HIT" [ref=e430]:
              - cell "39" [ref=e431]
              - cell "0.641" [ref=e432]
              - cell "0.400" [ref=e433]
              - cell "-0.240" [ref=e434]
              - cell "HIT" [ref=e435]
            - row "105 0.652 0.347 -0.305 MISS" [ref=e436]:
              - cell "105" [ref=e437]
              - cell "0.652" [ref=e438]
              - cell "0.347" [ref=e439]
              - cell "-0.305" [ref=e440]
              - cell "MISS" [ref=e441]
            - row "114 0.545 0.386 -0.158 HIT" [ref=e442]:
              - cell "114" [ref=e443]
              - cell "0.545" [ref=e444]
              - cell "0.386" [ref=e445]
              - cell "-0.158" [ref=e446]
              - cell "HIT" [ref=e447]
            - row "123 0.531 0.318 -0.213 HIT" [ref=e448]:
              - cell "123" [ref=e449]
              - cell "0.531" [ref=e450]
              - cell "0.318" [ref=e451]
              - cell "-0.213" [ref=e452]
              - cell "HIT" [ref=e453]
            - row "56 0.501 0.276 -0.225 HIT" [ref=e454]:
              - cell "56" [ref=e455]
              - cell "0.501" [ref=e456]
              - cell "0.276" [ref=e457]
              - cell "-0.225" [ref=e458]
              - cell "HIT" [ref=e459]
            - row "47 0.568 0.362 -0.207 HIT" [ref=e460]:
              - cell "47" [ref=e461]
              - cell "0.568" [ref=e462]
              - cell "0.362" [ref=e463]
              - cell "-0.207" [ref=e464]
              - cell "HIT" [ref=e465]
            - row "38 0.667 0.450 -0.218 HIT" [ref=e466]:
              - cell "38" [ref=e467]
              - cell "0.667" [ref=e468]
              - cell "0.450" [ref=e469]
              - cell "-0.218" [ref=e470]
              - cell "HIT" [ref=e471]
            - row "106 0.648 0.420 -0.228 HIT" [ref=e472]:
              - cell "106" [ref=e473]
              - cell "0.648" [ref=e474]
              - cell "0.420" [ref=e475]
              - cell "-0.228" [ref=e476]
              - cell "HIT" [ref=e477]
            - row "115 0.613 0.392 -0.222 HIT" [ref=e478]:
              - cell "115" [ref=e479]
              - cell "0.613" [ref=e480]
              - cell "0.392" [ref=e481]
              - cell "-0.222" [ref=e482]
              - cell "HIT" [ref=e483]
            - row "124 0.501 0.246 -0.255 MISS" [ref=e484]:
              - cell "124" [ref=e485]
              - cell "0.501" [ref=e486]
              - cell "0.246" [ref=e487]
              - cell "-0.255" [ref=e488]
              - cell "MISS" [ref=e489]
            - row "69 0.492 0.228 -0.264 MISS" [ref=e490]:
              - cell "69" [ref=e491]
              - cell "0.492" [ref=e492]
              - cell "0.228" [ref=e493]
              - cell "-0.264" [ref=e494]
              - cell "MISS" [ref=e495]
            - row "68 0.570 0.298 -0.272 MISS" [ref=e496]:
              - cell "68" [ref=e497]
              - cell "0.570" [ref=e498]
              - cell "0.298" [ref=e499]
              - cell "-0.272" [ref=e500]
              - cell "MISS" [ref=e501]
            - row "67 0.691 0.469 -0.221 HIT" [ref=e502]:
              - cell "67" [ref=e503]
              - cell "0.691" [ref=e504]
              - cell "0.469" [ref=e505]
              - cell "-0.221" [ref=e506]
              - cell "HIT" [ref=e507]
            - row "107 0.638 0.434 -0.204 HIT" [ref=e508]:
              - cell "107" [ref=e509]
              - cell "0.638" [ref=e510]
              - cell "0.434" [ref=e511]
              - cell "-0.204" [ref=e512]
              - cell "HIT" [ref=e513]
            - row "116 0.539 0.322 -0.217 HIT" [ref=e514]:
              - cell "116" [ref=e515]
              - cell "0.539" [ref=e516]
              - cell "0.322" [ref=e517]
              - cell "-0.217" [ref=e518]
              - cell "HIT" [ref=e519]
            - row "125 0.511 0.228 -0.283 MISS" [ref=e520]:
              - cell "125" [ref=e521]
              - cell "0.511" [ref=e522]
              - cell "0.228" [ref=e523]
              - cell "-0.283" [ref=e524]
              - cell "MISS" [ref=e525]
            - row "78 0.438 0.208 -0.231 HIT" [ref=e526]:
              - cell "78" [ref=e527]
              - cell "0.438" [ref=e528]
              - cell "0.208" [ref=e529]
              - cell "-0.231" [ref=e530]
              - cell "HIT" [ref=e531]
            - row "77 0.517 0.245 -0.273 MISS" [ref=e532]:
              - cell "77" [ref=e533]
              - cell "0.517" [ref=e534]
              - cell "0.245" [ref=e535]
              - cell "-0.273" [ref=e536]
              - cell "MISS" [ref=e537]
            - row "76 0.603 0.303 -0.299 MISS" [ref=e538]:
              - cell "76" [ref=e539]
              - cell "0.603" [ref=e540]
              - cell "0.303" [ref=e541]
              - cell "-0.299" [ref=e542]
              - cell "MISS" [ref=e543]
            - row "75 0.691 0.432 -0.258 MISS" [ref=e544]:
              - cell "75" [ref=e545]
              - cell "0.691" [ref=e546]
              - cell "0.432" [ref=e547]
              - cell "-0.258" [ref=e548]
              - cell "MISS" [ref=e549]
            - row "74 0.653 0.422 -0.232 HIT" [ref=e550]:
              - cell "74" [ref=e551]
              - cell "0.653" [ref=e552]
              - cell "0.422" [ref=e553]
              - cell "-0.232" [ref=e554]
              - cell "HIT" [ref=e555]
            - row "73 0.432 0.343 -0.089 HIT" [ref=e556]:
              - cell "73" [ref=e557]
              - cell "0.432" [ref=e558]
              - cell "0.343" [ref=e559]
              - cell "-0.089" [ref=e560]
              - cell "HIT" [ref=e561]
            - row "72 0.535 0.371 -0.164 HIT" [ref=e562]:
              - cell "72" [ref=e563]
              - cell "0.535" [ref=e564]
              - cell "0.371" [ref=e565]
              - cell "-0.164" [ref=e566]
              - cell "HIT" [ref=e567]
            - row "71 0.406 0.352 -0.054 HIT" [ref=e568]:
              - cell "71" [ref=e569]
              - cell "0.406" [ref=e570]
              - cell "0.352" [ref=e571]
              - cell "-0.054" [ref=e572]
              - cell "HIT" [ref=e573]
            - row "70 0.694 0.405 -0.289 MISS" [ref=e574]:
              - cell "70" [ref=e575]
              - cell "0.694" [ref=e576]
              - cell "0.405" [ref=e577]
              - cell "-0.289" [ref=e578]
              - cell "MISS" [ref=e579]
            - row "108 0.656 0.429 -0.227 HIT" [ref=e580]:
              - cell "108" [ref=e581]
              - cell "0.656" [ref=e582]
              - cell "0.429" [ref=e583]
              - cell "-0.227" [ref=e584]
              - cell "HIT" [ref=e585]
            - row "117 0.594 0.287 -0.306 MISS" [ref=e586]:
              - cell "117" [ref=e587]
              - cell "0.594" [ref=e588]
              - cell "0.287" [ref=e589]
              - cell "-0.306" [ref=e590]
              - cell "MISS" [ref=e591]
            - row "126 0.485 0.219 -0.266 MISS" [ref=e592]:
              - cell "126" [ref=e593]
              - cell "0.485" [ref=e594]
              - cell "0.219" [ref=e595]
              - cell "-0.266" [ref=e596]
              - cell "MISS" [ref=e597]
            - row "130 0.442 0.237 -0.206 HIT" [ref=e598]:
              - cell "130" [ref=e599]
              - cell "0.442" [ref=e600]
              - cell "0.237" [ref=e601]
              - cell "-0.206" [ref=e602]
              - cell "HIT" [ref=e603]
            - row "87 0.464 0.404 -0.060 HIT" [ref=e604]:
              - cell "87" [ref=e605]
              - cell "0.464" [ref=e606]
              - cell "0.404" [ref=e607]
              - cell "-0.060" [ref=e608]
              - cell "HIT" [ref=e609]
            - row "86 0.511 0.297 -0.214 HIT" [ref=e610]:
              - cell "86" [ref=e611]
              - cell "0.511" [ref=e612]
              - cell "0.297" [ref=e613]
              - cell "-0.214" [ref=e614]
              - cell "HIT" [ref=e615]
            - row "85 0.572 0.323 -0.249 HIT" [ref=e616]:
              - cell "85" [ref=e617]
              - cell "0.572" [ref=e618]
              - cell "0.323" [ref=e619]
              - cell "-0.249" [ref=e620]
              - cell "HIT" [ref=e621]
            - row "84 0.700 0.386 -0.314 MISS" [ref=e622]:
              - cell "84" [ref=e623]
              - cell "0.700" [ref=e624]
              - cell "0.386" [ref=e625]
              - cell "-0.314" [ref=e626]
              - cell "MISS" [ref=e627]
            - row "83 0.623 0.396 -0.227 HIT" [ref=e628]:
              - cell "83" [ref=e629]
              - cell "0.623" [ref=e630]
              - cell "0.396" [ref=e631]
              - cell "-0.227" [ref=e632]
              - cell "HIT" [ref=e633]
            - row "82 0.589 0.444 -0.144 HIT" [ref=e634]:
              - cell "82" [ref=e635]
              - cell "0.589" [ref=e636]
              - cell "0.444" [ref=e637]
              - cell "-0.144" [ref=e638]
              - cell "HIT" [ref=e639]
            - row "81 0.550 0.474 -0.075 HIT" [ref=e640]:
              - cell "81" [ref=e641]
              - cell "0.550" [ref=e642]
              - cell "0.474" [ref=e643]
              - cell "-0.075" [ref=e644]
              - cell "HIT" [ref=e645]
            - row "80 0.489 0.428 -0.061 HIT" [ref=e646]:
              - cell "80" [ref=e647]
              - cell "0.489" [ref=e648]
              - cell "0.428" [ref=e649]
              - cell "-0.061" [ref=e650]
              - cell "HIT" [ref=e651]
            - row "79 0.649 0.378 -0.270 MISS" [ref=e652]:
              - cell "79" [ref=e653]
              - cell "0.649" [ref=e654]
              - cell "0.378" [ref=e655]
              - cell "-0.270" [ref=e656]
              - cell "MISS" [ref=e657]
            - row "109 0.672 0.393 -0.279 MISS" [ref=e658]:
              - cell "109" [ref=e659]
              - cell "0.672" [ref=e660]
              - cell "0.393" [ref=e661]
              - cell "-0.279" [ref=e662]
              - cell "MISS" [ref=e663]
            - row "118 0.587 0.302 -0.285 MISS" [ref=e664]:
              - cell "118" [ref=e665]
              - cell "0.587" [ref=e666]
              - cell "0.302" [ref=e667]
              - cell "-0.285" [ref=e668]
              - cell "MISS" [ref=e669]
            - row "127 0.613 0.289 -0.324 MISS" [ref=e670]:
              - cell "127" [ref=e671]
              - cell "0.613" [ref=e672]
              - cell "0.289" [ref=e673]
              - cell "-0.324" [ref=e674]
              - cell "MISS" [ref=e675]
            - row "131 0.534 0.397 -0.137 HIT" [ref=e676]:
              - cell "131" [ref=e677]
              - cell "0.534" [ref=e678]
              - cell "0.397" [ref=e679]
              - cell "-0.137" [ref=e680]
              - cell "HIT" [ref=e681]
            - row "96 0.552 0.518 -0.034 HIT" [ref=e682]:
              - cell "96" [ref=e683]
              - cell "0.552" [ref=e684]
              - cell "0.518" [ref=e685]
              - cell "-0.034" [ref=e686]
              - cell "HIT" [ref=e687]
            - row "95 0.611 0.425 -0.186 HIT" [ref=e688]:
              - cell "95" [ref=e689]
              - cell "0.611" [ref=e690]
              - cell "0.425" [ref=e691]
              - cell "-0.186" [ref=e692]
              - cell "HIT" [ref=e693]
            - row "94 0.649 0.365 -0.284 MISS" [ref=e694]:
              - cell "94" [ref=e695]
              - cell "0.649" [ref=e696]
              - cell "0.365" [ref=e697]
              - cell "-0.284" [ref=e698]
              - cell "MISS" [ref=e699]
            - row "93 0.635 0.374 -0.261 MISS" [ref=e700]:
              - cell "93" [ref=e701]
              - cell "0.635" [ref=e702]
              - cell "0.374" [ref=e703]
              - cell "-0.261" [ref=e704]
              - cell "MISS" [ref=e705]
            - row "92 0.573 0.310 -0.263 MISS" [ref=e706]:
              - cell "92" [ref=e707]
              - cell "0.573" [ref=e708]
              - cell "0.310" [ref=e709]
              - cell "-0.263" [ref=e710]
              - cell "MISS" [ref=e711]
            - row "91 0.474 0.405 -0.069 HIT" [ref=e712]:
              - cell "91" [ref=e713]
              - cell "0.474" [ref=e714]
              - cell "0.405" [ref=e715]
              - cell "-0.069" [ref=e716]
              - cell "HIT" [ref=e717]
            - row "90 0.479 0.426 -0.054 HIT" [ref=e718]:
              - cell "90" [ref=e719]
              - cell "0.479" [ref=e720]
              - cell "0.426" [ref=e721]
              - cell "-0.054" [ref=e722]
              - cell "HIT" [ref=e723]
            - row "89 0.454 0.379 -0.075 HIT" [ref=e724]:
              - cell "89" [ref=e725]
              - cell "0.454" [ref=e726]
              - cell "0.379" [ref=e727]
              - cell "-0.075" [ref=e728]
              - cell "HIT" [ref=e729]
            - row "88 0.502 0.296 -0.206 HIT" [ref=e730]:
              - cell "88" [ref=e731]
              - cell "0.502" [ref=e732]
              - cell "0.296" [ref=e733]
              - cell "-0.206" [ref=e734]
              - cell "HIT" [ref=e735]
            - row "110 0.624 0.363 -0.261 MISS" [ref=e736]:
              - cell "110" [ref=e737]
              - cell "0.624" [ref=e738]
              - cell "0.363" [ref=e739]
              - cell "-0.261" [ref=e740]
              - cell "MISS" [ref=e741]
            - row "119 0.608 0.358 -0.251 MISS" [ref=e742]:
              - cell "119" [ref=e743]
              - cell "0.608" [ref=e744]
              - cell "0.358" [ref=e745]
              - cell "-0.251" [ref=e746]
              - cell "MISS" [ref=e747]
            - row "128 0.637 0.411 -0.226 HIT" [ref=e748]:
              - cell "128" [ref=e749]
              - cell "0.637" [ref=e750]
              - cell "0.411" [ref=e751]
              - cell "-0.226" [ref=e752]
              - cell "HIT" [ref=e753]
            - row "132 0.632 0.529 -0.103 HIT" [ref=e754]:
              - cell "132" [ref=e755]
              - cell "0.632" [ref=e756]
              - cell "0.529" [ref=e757]
              - cell "-0.103" [ref=e758]
              - cell "HIT" [ref=e759]
            - row "99 0.644 0.284 -0.359 MISS" [ref=e760]:
              - cell "99" [ref=e761]
              - cell "0.644" [ref=e762]
              - cell "0.284" [ref=e763]
              - cell "-0.359" [ref=e764]
              - cell "MISS" [ref=e765]
            - row "98 0.640 0.343 -0.297 MISS" [ref=e766]:
              - cell "98" [ref=e767]
              - cell "0.640" [ref=e768]
              - cell "0.343" [ref=e769]
              - cell "-0.297" [ref=e770]
              - cell "MISS" [ref=e771]
            - row "97 0.660 0.361 -0.299 MISS" [ref=e772]:
              - cell "97" [ref=e773]
              - cell "0.660" [ref=e774]
              - cell "0.361" [ref=e775]
              - cell "-0.299" [ref=e776]
              - cell "MISS" [ref=e777]
            - row "111 0.635 0.343 -0.292 MISS" [ref=e778]:
              - cell "111" [ref=e779]
              - cell "0.635" [ref=e780]
              - cell "0.343" [ref=e781]
              - cell "-0.292" [ref=e782]
              - cell "MISS" [ref=e783]
            - row "120 0.630 0.333 -0.298 MISS" [ref=e784]:
              - cell "120" [ref=e785]
              - cell "0.630" [ref=e786]
              - cell "0.333" [ref=e787]
              - cell "-0.298" [ref=e788]
              - cell "MISS" [ref=e789]
            - row "129 0.673 0.264 -0.409 MISS" [ref=e790]:
              - cell "129" [ref=e791]
              - cell "0.673" [ref=e792]
              - cell "0.264" [ref=e793]
              - cell "-0.409" [ref=e794]
              - cell "MISS" [ref=e795]
    - generic [ref=e796]:
      - strong [ref=e797]: Evidence provenance
      - generic [ref=e798]:
        - generic [ref=e799]: Case C, 270 deg from | measurements 72b031820ef2... | geometry 72b031820ef2... | 175,084 solid voxels
        - generic [ref=e800]: "Cite: Kikumoto, H., Okaze, T., Yoshie, R., Tachibana, T., Ishihara, T., Nonomura, Y., Kiyota, N., Kondo, H., Mochida, A. & Tominaga, Y. (2026), \"Comprehensive Experimental Database for Validating CFD Simulations in Urban Wind Environment: Benchmark Cases Curated by the Architectural Institute of Japan\", Japan Architectural Review 9(1), e70083. https://doi.org/10.1002/2475-8876.70083 | Nonomura, Y., Kobayashi, N., Tominaga, Y. & Mochida, A. (2003), \"The cross comparison of CFD prediction for flow field around building blocks (part 3)\", Summaries of Technical Papers of Annual Meeting, Japan Association for Wind Engineering 2003, 41. https://doi.org/10.14887/jaweam.2003.0.41.0 | Tominaga, Y., Mochida, A., Yoshie, R., Kataoka, H., Nozu, T., Yoshikawa, M. & Shirasawa, T. (2008), \"AIJ guidelines for practical applications of CFD to pedestrian wind environment around buildings\", J. Wind Eng. Ind. Aerodyn. 96(10-11), 1749-1761. https://doi.org/10.1016/j.jweia.2008.02.058"
        - generic [ref=e801]: These derived files were created and processed independently for AeroFlow. The Architectural Institute of Japan (AIJ) does not guarantee their quality, accuracy, completeness, or suitability for any particular purpose.
  - group [ref=e802]:
    - generic "AeroFlow · AIJ Case C/E (validation)" [ref=e803] [cursor=pointer]
```

# Test source

```ts
  15  |  *     ~18.9M cells); q≥0.66 is the physics acceptance and is what gates here.
  16  |  *   - Case E V15: ~2.7B cells — infeasible on a 24 GB card at the strict rule. It self-skips
  17  |  *     as INCONCLUSIVE at any runnable budget until a benchmark-faithful domain crop lands.
  18  |  */
  19  | const NOMINAL_BUDGET_CELLS = 384 * 384 * 128; // the M11.md wall-time gate's reference grid
  20  | const configuredCells = Number(process.env.AEROFLOW_M11_CELLS);
  21  | const hasConfiguredBudget = Number.isFinite(configuredCells) && configuredCells >= 512;
  22  | 
  23  | interface AcceptanceCase {
  24  |   caseId: 'C' | 'E';
  25  |   direction: number;
  26  |   points: number;
  27  | }
  28  | 
  29  | async function runAcceptance(
  30  |   page: Page,
  31  |   testInfo: TestInfo,
  32  |   acceptance: AcceptanceCase,
  33  | ): Promise<void> {
  34  |   test.skip(
  35  |     !hasConfiguredBudget,
  36  |     'Set AEROFLOW_M11_CELLS to an acceptance-ready uniform-grid budget.',
  37  |   );
  38  |   const { caseId, direction, points } = acceptance;
  39  |   await page.goto(
  40  |     `${BASE_URL}/?urban&case=${caseId}&direction=${direction}&cells=${configuredCells}`,
  41  |   );
  42  |   await page.getByTestId('urban-run').click();
  43  |   await expect
  44  |     .poll(
  45  |       async () => {
  46  |         const urban = (await readHooks(page)).urban;
  47  |         if (urban?.error) throw new Error(urban.error);
  48  |         return urban?.totalSteps;
  49  |       },
  50  |       { timeout: 10 * 60_000 },
  51  |     )
  52  |     .toBeDefined();
  53  |   const planned = (await readHooks(page)).urban!;
  54  |   await testInfo.attach(`case-${caseId}-${direction}-plan`, {
  55  |     body: JSON.stringify(planned, null, 2),
  56  |     contentType: 'application/json',
  57  |   });
  58  |   test.skip(
  59  |     planned.underResolved === true,
  60  |     `INCONCLUSIVE: ${configuredCells.toLocaleString()} cells is below the ` +
  61  |       `${planned.requiredCells?.toLocaleString()}-cell resolution requirement.`,
  62  |   );
  63  | 
  64  |   // TIME BUDGET, not a gate. The physics gate is q≥0.66 and is untouched; the separate
  65  |   // 30-minute wall-time gate applies only near NOMINAL_BUDGET_CELLS (asserted below).
  66  |   //
  67  |   // Corrected 2026-08-15. This was 2 h, derived from a "~1.4 h on the reference RTX 3090"
  68  |   // estimate that D1 records as FALSIFIED (D1:135 — "measurement 2026-07-28: ≥ 8.7 h").
  69  |   // The strict grid's measured cost is 5.96 h — 21,454 s for 365,560 steps, 120/120 points,
  70  |   // ~3261 scene MLUPs at 97–99% duty, on this same RTX 3090 (D1:245). A 2 h poll therefore
  71  |   // could not have returned a verdict regardless of solver behaviour, which is exactly what
  72  |   // the aborted 2026-08-15-1450 run demonstrated. 8 h is ~1.34× the measured cost.
  73  |   const completionTimeoutMs = caseId === 'C' ? 8 * 60 * 60_000 : 35 * 60_000;
  74  | 
  75  |   // Stall detector. D1's Wall-3 section records an INTERMITTENT Case C hang whose signature
  76  |   // is a run that does healthy work and then freezes — steps and compute duty stop together
  77  |   // — and credits a 6-minute no-progress checkpoint-resume detector for the run that did
  78  |   // complete. This harness had no equivalent, so a longer budget would have made that hang
  79  |   // more expensive rather than less. Fail fast and loudly instead of burning the budget:
  80  |   // a stall is an EXECUTION finding, never a physics result.
  81  |   const STALL_TIMEOUT_MS = 6 * 60_000;
  82  |   let lastSteps = -1;
  83  |   let lastProgressAt = Date.now();
  84  |   await expect
  85  |     .poll(
  86  |       async () => {
  87  |         const urban = (await readHooks(page)).urban;
  88  |         if (urban?.error) throw new Error(urban.error);
  89  |         const steps = urban?.totalSteps ?? -1;
  90  |         if (steps > lastSteps) {
  91  |           lastSteps = steps;
  92  |           lastProgressAt = Date.now();
  93  |         } else if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
  94  |           throw new Error(
  95  |             `STALLED: case ${caseId} made no step progress for ` +
  96  |               `${((Date.now() - lastProgressAt) / 60_000).toFixed(1)} min at step ${lastSteps}. ` +
  97  |               `This matches the intermittent hang recorded in D1 (Wall 3), whose root cause ` +
  98  |               `is unknown and which did not reproduce on the following run. Reported as an ` +
  99  |               `EXECUTION failure, NOT a physics result — q was never evaluated.`,
  100 |           );
  101 |         }
  102 |         return urban?.complete;
  103 |       },
  104 |       { timeout: completionTimeoutMs, intervals: [15_000] },
  105 |     )
  106 |     .toBe(true);
  107 |   const result = (await readHooks(page)).urban!;
  108 |   await testInfo.attach(`case-${caseId}-${direction}-result`, {
  109 |     body: JSON.stringify(result, null, 2),
  110 |     contentType: 'application/json',
  111 |   });
  112 |   expect(result.underResolved).toBe(false);
  113 |   expect(result.averagingFlowThroughs).toBeGreaterThanOrEqual(10);
  114 |   expect(result.reportRows).toBe(points);
> 115 |   expect(result.q).toBeGreaterThanOrEqual(0.66);
      |                    ^ Error: expect(received).toBeGreaterThanOrEqual(expected)
  116 |   if (caseId === 'E') expect(result.r).toBeGreaterThanOrEqual(0.7);
  117 |   expect(result.verdict).toBe('pass');
  118 | 
  119 |   // Wall time is always recorded. The M11.md ≤30-min/direction target is defined at the
  120 |   // nominal ~18.9M-cell grid; the strict third-node rule forces far larger acceptance grids
  121 |   // for the real fixtures (Case C ≈ 183M), where the run is checkpointed/resumable instead.
  122 |   // Hard-gate the time only near the nominal budget; above it, q/r is the acceptance.
  123 |   const wallMs = (result.elapsedMs ?? Infinity) + (result.voxelizationMs ?? Infinity);
  124 |   await testInfo.attach(`case-${caseId}-${direction}-walltime`, {
  125 |     body: `${(wallMs / 60_000).toFixed(1)} min at ${configuredCells.toLocaleString()} cells`,
  126 |     contentType: 'text/plain',
  127 |   });
  128 |   if (configuredCells <= 1.5 * NOMINAL_BUDGET_CELLS) {
  129 |     expect(wallMs).toBeLessThanOrEqual(30 * 60_000);
  130 |   }
  131 | }
  132 | 
  133 | test('V14 Case C at 270 degrees', async ({ gpuPage }, testInfo) => {
  134 |   test.setTimeout(8.5 * 60 * 60_000); // must exceed the 8 h completion poll
  135 |   await runAcceptance(gpuPage, testInfo, { caseId: 'C', direction: 270, points: 120 });
  136 | });
  137 | 
  138 | for (const direction of [0, 90]) {
  139 |   test(`V15 Case E at ${direction} degrees`, async ({ gpuPage }, testInfo) => {
  140 |     test.setTimeout(45 * 60_000);
  141 |     await runAcceptance(gpuPage, testInfo, { caseId: 'E', direction, points: 80 });
  142 |   });
  143 | }
  144 | 
```