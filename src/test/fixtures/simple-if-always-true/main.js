function absWithBugs (x) {
  if (x > 0) { // Should be <
    x *= 1; // Should be -1
  }
  return x;
}

absWithBugs(3);
absWithBugs(10);
