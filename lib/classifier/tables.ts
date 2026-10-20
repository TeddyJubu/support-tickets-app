// Classifier rule tables, ported from the Shopify helpdesk (processor/classifier/tables).
// Each rule: a regex (lower-cased text) and an exemplar sentence it must match (tested).
// tier: immediate = sensitive, owner alert; high = urgent. view: unfiltered = raw text,
// filtered = text with store boilerplate removed.

export interface Rule {
  pattern: string;
  exemplar: string;
  tier: "immediate" | "high";
  view: "unfiltered" | "filtered";
}

export const IMMEDIATE_MAIN: Rule[] = [
  {
    "pattern": "\\brefund\\b",
    "exemplar": "I need a refund for this order.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bchargeback\\b",
    "exemplar": "I am filing a chargeback with my bank.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bdispute\\b",
    "exemplar": "I am opening a dispute for this payment.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bmoney\\s+back\\b",
    "exemplar": "Money back, please.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\breimburse\\b",
    "exemplar": "Please reimburse me for this order.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\breimbursement\\b",
    "exemplar": "I am requesting reimbursement for this purchase.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bcompensat\\w*\\b",
    "exemplar": "I am asking for compensation for the delay.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bcredit\\s+(my|your|our)\\s+account\\b",
    "exemplar": "Please credit my account.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bissue\\s+a\\s+refund\\b",
    "exemplar": "Please issue a refund for me.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\breturn\\s+(my|the)\\s+(money|payment|funds)\\b",
    "exemplar": "Please return the payment to my card.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bdamaged?\\b",
    "exemplar": "The item arrived damaged.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bdefect\\w*\\b",
    "exemplar": "There is a defect in the product.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bbroken\\b",
    "exemplar": "The product is broken.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\btorn\\b",
    "exemplar": "The garment is torn.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bwrong\\s+(item|size|color|colour|product|order)\\b",
    "exemplar": "Wrong item.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bmissing\\s+(item|piece|part|product)\\b",
    "exemplar": "Missing item.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bnever\\s+(received|arrived|came|got)\\b",
    "exemplar": "I never received the item.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bdidn'?t\\s+(receive|get|arrive)\\b",
    "exemplar": "I didn't receive anything.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bnot\\s+received\\b",
    "exemplar": "It was not received.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\blost\\s+(package|parcel|order|shipment)\\b",
    "exemplar": "Lost package.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bstolen\\s+(package|parcel|order|shipment)\\b",
    "exemplar": "A stolen package was reported.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\b(package|parcel|order|shipment)\\s+(?:was|is|got|has\\s+been)\\s+(lost|stolen)\\b",
    "exemplar": "The package was stolen.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\b(angry|furious|outraged|disgusted|appalled|unacceptable)\\b",
    "exemplar": "I am angry about this order.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\b(terrible|horrible|awful|worst)\\s+(service|experience|company|store)\\b",
    "exemplar": "This is terrible service.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bnever\\s+(shopping|buying|ordering)\\s+(here|from\\s+you)\\b",
    "exemplar": "I am never shopping here again.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\b(bbb|better\\s+business\\s+bureau|consumer\\s+protection|small\\s+claims)\\b",
    "exemplar": "I will report this to the BBB.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\b(lawsuit|sue|legal\\s+action|attorney|lawyer)\\b",
    "exemplar": "I will take legal action.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bfraud\\b",
    "exemplar": "This payment is fraud.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bscam\\b",
    "exemplar": "This store is a scam.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bunauthorized\\s+charg\\w+\\b",
    "exemplar": "There was an unauthorized charge on my card.",
    "tier": "immediate",
    "view": "unfiltered"
  }
];

export const IMMEDIATE_PORT: Rule[] = [
  {
    "pattern": "\\bcharge\\s?-?\\s?back\\b",
    "exemplar": "I will charge back the payment.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bcharged\\s+back\\b",
    "exemplar": "I have charged back the payment.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\breverse\\s+the\\s+(charge|payment)\\b",
    "exemplar": "Please reverse the charge.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bdisput(?:ing|ed)\\b",
    "exemplar": "I am disputing this with my bank.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bcontest\\s+the\\s+charge\\b",
    "exemplar": "I will contest the charge.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\b(?:did\\s+not|didn'?t|never|have\\s+not|haven'?t)\\s+authoris?z?e\\w*\\b",
    "exemplar": "I never authorised this payment.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bunauthoris(?:ed|ing)\\s+(charge|transaction|payment)\\b",
    "exemplar": "There is an unauthorised transaction on my card.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bunauthorized\\s+transaction\\b",
    "exemplar": "There is an unauthorized transaction.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bfraudulent\\b",
    "exemplar": "This looks fraudulent.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bscamm(?:ed|er)\\b",
    "exemplar": "I have been scammed.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\b(?:is|was|are|were|be|what)\\s+(?:a|an)\\s+rip[\\s-]?off\\b",
    "exemplar": "This is a rip off.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\b(?:total|complete|absolute|utter|proper|such\\s+a)\\s+rip[\\s-]?off\\b",
    "exemplar": "Total rip-off.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\brip[\\s-]?off\\s+(?:price|prices|merchant|merchants|company|site|shop)\\b",
    "exemplar": "Rip off merchants, the lot of you.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bripped\\s+(?:me|us)\\s+off\\b",
    "exemplar": "You ripped me off.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bstole\\s+my\\s+money\\b",
    "exemplar": "They stole my money.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\b(?:want|give\\s+me|return)\\s+my\\s+money\\b",
    "exemplar": "I want my money.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\byou\\s+stole\\b",
    "exemplar": "You stole from me.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\b(?:this|that|it)\\s+is\\s+theft\\b",
    "exemplar": "This is theft.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\breport(?:ing)?\\s+(?:this\\s+)?(?:as\\s+)?theft\\b",
    "exemplar": "I am reporting this as theft.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\byou\\s+(?:have\\s+)?stolen\\b",
    "exemplar": "You have stolen from me.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bsuing\\b",
    "exemplar": "I am suing.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\blegal\\s+counsel\\b",
    "exemplar": "I have retained legal counsel.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bcease\\s+and\\s+desist\\b",
    "exemplar": "Consider this a cease and desist.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bfile\\s+a\\s+complaint\\b",
    "exemplar": "I will file a complaint.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\b(?:is\\s?n'?t|was\\s?n'?t|not)\\s+what\\s+i\\s+ordered\\b",
    "exemplar": "This isn't what I ordered.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\b(?:got|sent|received)\\s+the\\s+wrong\\b",
    "exemplar": "She received the wrong bag.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\b(?:items?|parcel|package|box|order|name|address|label)\\b[^.!?]{0,30}\\bnot\\s+mine\\b",
    "exemplar": "The items in the box are not mine.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bnot\\s+as\\s+described\\b",
    "exemplar": "It is not as described.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\blooks?\\s+nothing\\s+like\\b",
    "exemplar": "It looks nothing like it.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bnothing\\s+like\\s+the\\s+(photo|picture|listing|description|website)\\b",
    "exemplar": "Nothing like the photo.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bbut\\s+(?:i\\s+)?got\\s+(?:a|an|the)\\s(?!error|message|email|reply|response|notification|code|discount|confirmation|receipt|voucher|refund|call|text)",
    "exemplar": "I picked blue but got a pink one.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bbut\\s+received\\s+(?:a|an|the)\\s(?!error|message|email|reply|response|notification|code|discount|confirmation|receipt|voucher|refund|call|text)",
    "exemplar": "I picked blue but received a pink one.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\binstead\\s+i\\s+got\\b",
    "exemplar": "Instead I got the gown.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\byou\\s+(?:sent|shipped|packed)\\s+(?:me\\s+)?(?:(?:a|an|the)\\s*)?(?:wrong|different|completely\\s+different)\\b",
    "exemplar": "You sent me a different item.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bcracked\\b",
    "exemplar": "It is cracked.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bshattered\\b",
    "exemplar": "It is shattered.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bfrayed\\b",
    "exemplar": "The hem is frayed.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bfell\\s+apart\\b",
    "exemplar": "It fell apart.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bseam\\s+ripped\\b",
    "exemplar": "The seam ripped.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\b(?:there\\s?'?s|there\\s+is|it\\s+has|it\\s+had|came\\s+with|arrived\\s+with|turned\\s+up\\s+with|found)\\s+(?:a\\s+)?(?:big\\s+|small\\s+|large\\s+|huge\\s+|tiny\\s+)?(?:hole|rip|tear|stain|snag)\\b(?!\\s*(?:-\\s*)?away)",
    "exemplar": "There is a hole in the fabric.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\b(?:did\\s+not|didn'?t)\\s+come\\s+with\\b",
    "exemplar": "It didn't come with the bib.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\b(?:marked|says|shows|tracking\\s+says)\\s+(?:it\\s+was\\s+|as\\s+)?delivered\\s+but\\b",
    "exemplar": "It is marked delivered but I have not seen it.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bnothing\\s+(?:is\\s+)?here\\b",
    "exemplar": "The courier says delivered, nothing is here.",
    "tier": "immediate",
    "view": "filtered"
  }
];

export const WEAK_DAMAGE: Rule[] = [
  {
    "pattern": "\\bripped\\b",
    "exemplar": "The parcel held a ripped bodysuit.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bstained\\b",
    "exemplar": "My order held a stained bib.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\b(?:for|to|belongs?\\s+to|addressed\\s+to|labell?ed\\s+(?:for|to)|meant\\s+for)\\s+another\\s+customer\\b",
    "exemplar": "The box is labelled for another customer.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\banother\\s+customer'?s\\s+(?:order|name|parcel|package|box|address|details|items?)\\b",
    "exemplar": "The parcel has another customer's name on it.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bsomeone\\s+else'?s?\\s+(order|items?|package|parcel|box)\\b",
    "exemplar": "The box holds someone else's order.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\ba\\s+(?:hole|rip|tear|stain)\\b(?!-)(?!\\s*(?:-\\s*)?away)",
    "exemplar": "My parcel held a top with a stain.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\b(?:hole|rip|tear|stain)\\b(?!-)\\s+(?:in|on)\\b",
    "exemplar": "My parcel held a top with holes, hole in the arm.",
    "tier": "immediate",
    "view": "filtered"
  }
];

export const WEAK_OMISSION: Rule[] = [
  {
    "pattern": "\\bmissing\\b",
    "exemplar": "One item is missing from the parcel.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\blost\\b",
    "exemplar": "My parcel seems lost.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bwithout\\s+the\\b",
    "exemplar": "The set arrived without the headband.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bnot\\s+included\\b",
    "exemplar": "The hat was not included in my order.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bwas\\s?n'?t\\s+included\\b",
    "exemplar": "The hat wasn't included in my order.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bleft\\s+out\\b",
    "exemplar": "The socks were left out of the box.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bsupposed\\s+to\\s+include\\b",
    "exemplar": "My order was supposed to include a bib.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bdifferent\\s+item\\b",
    "exemplar": "My parcel held a completely different item.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\binstead\\s+of\\s+the\\b",
    "exemplar": "My parcel held the gown instead of the romper.",
    "tier": "immediate",
    "view": "filtered"
  }
];

export const HIGH_MAIN: Rule[] = [
  {
    "pattern": "\\burgent(?:ly)?\\b",
    "exemplar": "This order is urgent and I need help.",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\basap\\b",
    "exemplar": "Please send an update ASAP.",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\brush\\b",
    "exemplar": "Please rush this order.",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bexpress\\b",
    "exemplar": "Can you ship this by express delivery?",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bneed\\s+(it|them)\\s+(by|before|tomorrow|today|monday|tuesday|wednesday|thursday|friday)\\b",
    "exemplar": "I need it by Friday for the party.",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bdeadline\\b",
    "exemplar": "I have a deadline for this order.",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\btime\\s+sensitive\\b",
    "exemplar": "This request is time sensitive.",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bchange\\s+(my\\s+)?(shipping\\s+)?address\\b",
    "exemplar": "Please change my shipping address before dispatch.",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bwrong\\s+address\\b",
    "exemplar": "The delivery is going to the wrong address.",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bupdate\\s+(my\\s+)?address\\b",
    "exemplar": "Please update my address before shipping.",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bnew\\s+address\\b",
    "exemplar": "I have a new address for this order.",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bcancel\\s+(my\\s+)?(order|item|purchase)\\b",
    "exemplar": "Please cancel my order before it ships.",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bcancellation\\b",
    "exemplar": "I need help with an order cancellation.",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bfinal\\s+sale\\b",
    "exemplar": "Is this item final sale?",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bno\\s+returns?\\b",
    "exemplar": "Does this item have no returns?",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bwhere\\s+is\\s+my\\s+(order|package|parcel)\\b",
    "exemplar": "Where is my order?",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\b(haven'?t|have\\s+not)\\s+(received|gotten|seen)\\b",
    "exemplar": "I haven't received my order yet.",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bnot\\s+yet\\s+(received|arrived|delivered)\\b",
    "exemplar": "My order is not yet delivered.",
    "tier": "high",
    "view": "unfiltered"
  },
  {
    "pattern": "\\blast\\s+(chance|warning)\\b",
    "exemplar": "This is my last chance to get the gift.",
    "tier": "high",
    "view": "unfiltered"
  }
];

export const HIGH_PORT: Rule[] = [
  {
    "pattern": "\\b(?:has\\s?n'?t|has\\s+not|have\\s+not|have\\s?n'?t)\\s+(?:arrived|turned\\s+up|shown\\s+up)\\b",
    "exemplar": "My parcels haven't arrived.",
    "tier": "high",
    "view": "filtered"
  },
  {
    "pattern": "\\bstill\\s+(?:has\\s?n'?t|have\\s?n'?t|not)\\s+(?:arrived|come|received)\\b",
    "exemplar": "It still hasn't come.",
    "tier": "high",
    "view": "filtered"
  },
  {
    "pattern": "\\bnot\\s+(?:been\\s+)?delivered\\b",
    "exemplar": "It was not delivered.",
    "tier": "high",
    "view": "filtered"
  },
  {
    "pattern": "\\bnothing\\s+(?:has\\s+|had\\s+)?(?:arrived|come|turned\\s+up|showed\\s+up|been\\s+delivered)\\b",
    "exemplar": "Nothing has arrived.",
    "tier": "high",
    "view": "filtered"
  },
  {
    "pattern": "\\bwhere\\s+my\\s+(?:order|parcel|package|delivery|items?|stuff)\\s+(?:is|are)\\b",
    "exemplar": "Do you know where my parcel is?",
    "tier": "high",
    "view": "filtered"
  }
];

export const MANAGER: Rule[] = [
  {
    "pattern": "\\b(?:speak|talk)\\s+to\\s+(?:a|your|the)\\s+(?:manager|supervisor|owner)\\b",
    "exemplar": "Let me talk to a manager.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bget\\s+me\\s+(?:a|your|the)\\s+(?:manager|supervisor|owner)\\b",
    "exemplar": "Get me a manager.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bwant\\s+(?:a|to\\s+speak\\s+to\\s+a)\\s+manager\\b",
    "exemplar": "I want a manager.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\byour\\s+supervisor\\b",
    "exemplar": "Put me through to your supervisor.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\bi\\s+demand\\b",
    "exemplar": "I demand an answer.",
    "tier": "immediate",
    "view": "filtered"
  },
  {
    "pattern": "\\b(?:owner|manager|supervisor)'?s?\\s+(?:personal\\s+)?(?:phone|number|cell|mobile|email|address)\\b",
    "exemplar": "Give me the owner's personal phone number.",
    "tier": "immediate",
    "view": "filtered"
  }
];

export const ANGRY: Rule[] = [
  {
    "pattern": "\\b(angry|furious|outraged|disgusted|appalled|unacceptable)\\b",
    "exemplar": "I am angry that my refund is still missing.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\b(terrible|horrible|awful|worst)\\b",
    "exemplar": "This is terrible service and I need a refund.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\bnever\\s+(shopping|buying|ordering)\\s+(here|from\\s+you)\\b",
    "exemplar": "I am never shopping here again because I need a refund.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\b(bbb|better\\s+business\\s+bureau|consumer\\s+protection|small\\s+claims)\\b",
    "exemplar": "I will report this to the BBB if my refund is not resolved.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\b(lawsuit|sue|legal\\s+action|attorney|lawyer)\\b",
    "exemplar": "I will take legal action over this refund.",
    "tier": "immediate",
    "view": "unfiltered"
  },
  {
    "pattern": "\\b(scam|fraud|rip\\s?off|robbed)\\b",
    "exemplar": "This feels like a scam and I want a refund.",
    "tier": "immediate",
    "view": "unfiltered"
  }
];

export const INTENTS = {
  "sensitive": [
    "refund/request",
    "order/wrong",
    "cancellation",
    "payment-error",
    "chargeback",
    "dispute",
    "refund",
    "order/damaged",
    "cancel",
    "address-change",
    "payment-dispute",
    "order/missing"
  ],
  "high": [
    "rush",
    "urgent",
    "cancel",
    "cancellation",
    "address-change",
    "final-sale-exception"
  ],
  "high_sensitive": [
    "cancel",
    "cancellation",
    "address-change",
    "final-sale-exception"
  ]
};

export const CAPS = {
  "stopwords": [
    "USPS",
    "UPS",
    "DHL",
    "FEDEX",
    "USA",
    "UK",
    "EU",
    "CAD",
    "USD",
    "GBP",
    "ASAP",
    "VAT",
    "GST",
    "PST",
    "EST",
    "CST",
    "MST",
    "UTC",
    "PDT",
    "EDT",
    "COD",
    "PIN",
    "SKU",
    "FAQ",
    "URL",
    "PDF",
    "OMG",
    "AM",
    "PM",
    "ID",
    "OK",
    "THE",
    "AND",
    "FOR",
    "YOU",
    "ARE",
    "WAS",
    "BUT",
    "NOT",
    "ALL",
    "ANY",
    "CAN",
    "GET",
    "HAS",
    "HAD",
    "MY",
    "ME",
    "IT",
    "IS",
    "IN",
    "ON",
    "TO",
    "OF",
    "AT",
    "SO",
    "IF",
    "OR",
    "DO",
    "BE",
    "BY",
    "UP",
    "NO"
  ],
  "anchors": [
    "NEVER",
    "STILL",
    "UNACCEPTABLE",
    "RIDICULOUS",
    "TERRIBLE",
    "AWFUL",
    "WORST",
    "HORRIBLE",
    "JOKE",
    "SERIOUSLY",
    "ENOUGH",
    "SICK",
    "TIRED",
    "FED",
    "USELESS",
    "APPALLING",
    "DISGRACE",
    "DISGUSTING",
    "PATHETIC",
    "ANGRY",
    "FURIOUS",
    "NOBODY",
    "IGNORING",
    "IGNORED",
    "REFUND",
    "MONEY",
    "SCAM",
    "FRAUD",
    "LAWYER",
    "DEMAND",
    "COMPLAINT",
    "WRONG",
    "BROKEN",
    "DAMAGED",
    "MISSING",
    "CANCEL",
    "IMMEDIATELY",
    "ANSWER",
    "ANSWERED",
    "REPLY",
    "RESPOND",
    "RESPONSE",
    "WAITING",
    "PHONE",
    "MANAGER",
    "SUPERVISOR",
    "URGENT",
    "SHOCKING",
    "DISGRACEFUL",
    "LIVID",
    "FUMING",
    "SEETHING",
    "SHAMBLES",
    "FIASCO"
  ],
  "grammar": [
    "YOU",
    "YOUR",
    "YOURS",
    "ME",
    "MY",
    "MINE",
    "WE",
    "US",
    "OUR",
    "THIS",
    "THAT",
    "THESE",
    "THOSE",
    "IS",
    "ARE",
    "AM",
    "WAS",
    "WERE",
    "BE",
    "BEEN",
    "HAVE",
    "HAS",
    "HAD",
    "WILL",
    "WONT",
    "CANT",
    "DONT",
    "DOES",
    "DID",
    "KNOW",
    "THINK",
    "TREAT",
    "SAID",
    "TOLD",
    "WANT",
    "NEED",
    "GET",
    "GOT",
    "SEND",
    "SENT",
    "GIVE",
    "GAVE",
    "PAID",
    "WAIT",
    "WAITED",
    "WAITING",
    "KEEP",
    "STOP",
    "LOOK",
    "TAKE",
    "MAKE",
    "WITH",
    "WHAT",
    "WHY",
    "HOW"
  ],
  "complaint_verbs": [
    "HAD",
    "ENOUGH",
    "TREAT",
    "TREATED",
    "TREATING",
    "IGNORE",
    "IGNORED",
    "IGNORING",
    "WAITING",
    "WAITED",
    "PAID",
    "PROMISED",
    "TOLD",
    "ASKED",
    "WANT",
    "WANTED",
    "NEED",
    "DEMAND",
    "FIX",
    "SORT",
    "SORTED",
    "REFUSE",
    "REFUSED",
    "LIED",
    "STOLE",
    "CHARGED",
    "RUINED",
    "WASTED",
    "DISAPPOINTED"
  ],
  "hard_anchors": [
    "REFUND",
    "SCAM",
    "FRAUD",
    "LAWYER",
    "DEMAND",
    "COMPLAINT",
    "UNACCEPTABLE",
    "RIDICULOUS",
    "DISGRACE",
    "DISGUSTING",
    "PATHETIC",
    "APPALLING",
    "USELESS",
    "FURIOUS",
    "ANGRY",
    "WORST",
    "AWFUL",
    "TERRIBLE",
    "HORRIBLE",
    "JOKE",
    "ENOUGH",
    "NOBODY",
    "IGNORED",
    "IGNORING",
    "MISSING",
    "DAMAGED",
    "BROKEN",
    "WRONG",
    "CANCEL",
    "SHOCKING",
    "DISGRACEFUL",
    "LIVID",
    "FUMING",
    "SEETHING",
    "SHAMBLES",
    "FIASCO"
  ]
};
