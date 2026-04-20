FROM eclipse-temurin:17-jre-jammy
WORKDIR /app
COPY libs /app/lib/
COPY docker-run.sh /app/
RUN chmod 755 /app/docker-run.sh
ENV PORT=8080
CMD ["/app/docker-run.sh"]
